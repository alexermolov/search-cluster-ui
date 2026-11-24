import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RedisKeyEntry, RedisKeyType } from "../../../shared/types";

const ROW_HEIGHT = 32;
const OVERSCAN = 5;
const FOLDER_OPEN = "▾";
const FOLDER_CLOSED = "▸";

export interface RedisKeyTreeNode {
  key: string;
  name: string;
  fullKey: string;
  level: number;
  type?: RedisKeyType;
  ttlMs?: number;
  keyCount?: number;
  expanded?: boolean;
  children?: RedisKeyTreeNode[];
}

export interface RedisKeyTreeProps {
  entries: RedisKeyEntry[];
  separator: string;
  selectedKey: string | null;
  onSelectKey: (key: string) => void;
  onToggleFolder: (fullKey: string) => void;
  expandedFolders: Set<string>;
  height: number;
  onScroll: (top: number, height: number) => void;
  top: number;
}

interface TempNode {
  key: string;
  name: string;
  fullKey: string;
  level: number;
  type?: RedisKeyType;
  ttlMs?: number;
  expanded?: boolean;
  children?: Record<string, TempNode>;
}

function buildTree(
  entries: RedisKeyEntry[],
  separator: string,
  expanded: Set<string>,
): RedisKeyTreeNode[] {
  if (!separator) {
    return entries.map((entry) => ({
      key: entry.key,
      name: entry.key,
      fullKey: entry.key,
      level: 0,
      type: entry.type,
      ttlMs: entry.ttlMs,
    }));
  }

  const root: Record<string, TempNode> = {};

  for (const entry of entries) {
    const parts = entry.key.split(separator);
    let current = root;
    let prefix = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullKey = prefix ? `${prefix}${separator}${part}` : part;

      if (isLast) {
        current[`${fullKey}\0`] = {
          key: fullKey,
          name: part || '[Empty]',
          fullKey: entry.key,
          level: i,
          type: entry.type,
          ttlMs: entry.ttlMs,
        };
      } else {
        if (!current[fullKey]) {
          current[fullKey] = {
            key: fullKey,
            name: part || '[Empty]',
            fullKey,
            level: i,
            expanded: expanded.has(fullKey),
            children: {},
          };
        }
        prefix = fullKey;
        current = current[fullKey].children!;
      }
    }
  }

  function toTree(record: Record<string, TempNode>): RedisKeyTreeNode[] {
    const values = Object.values(record);
    values.sort((a, b) => {
      const aFolder = !!a.children;
      const bFolder = !!b.children;
      if (aFolder && !bFolder) return -1;
      if (!aFolder && bFolder) return 1;
      return a.name.localeCompare(b.name);
    });
    return values.map((node) => {
      const children = node.children ? toTree(node.children) : undefined;
      const treeNode: RedisKeyTreeNode = {
        key: node.key,
        name: node.name,
        fullKey: node.fullKey,
        level: node.level,
        type: node.type,
        ttlMs: node.ttlMs,
        expanded: node.expanded,
        children,
      };
      if (children) {
        treeNode.keyCount = children.reduce(
          (sum, child) => sum + (child.keyCount ?? 1),
          0,
        );
      }
      return treeNode;
    });
  }

  function flatten(nodes: RedisKeyTreeNode[]): RedisKeyTreeNode[] {
    const result: RedisKeyTreeNode[] = [];
    for (const node of nodes) {
      result.push(node);
      if (node.children && node.expanded) {
        result.push(...flatten(node.children));
      }
    }
    return result;
  }

  return flatten(toTree(root));
}

function formatTtl(ttlMs: number): string {
  if (ttlMs === -1) return "Persistent";
  if (ttlMs === -2) return "Expired";
  if (ttlMs < 1000) return `${ttlMs} ms`;
  return `${(ttlMs / 1000).toFixed(1)} s`;
}

export function RedisKeyTree({
  entries,
  separator,
  selectedKey,
  onSelectKey,
  onToggleFolder,
  expandedFolders,
  height,
  onScroll,
  top,
}: RedisKeyTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodes = useMemo(
    () => buildTree(entries, separator, expandedFolders),
    [entries, separator, expandedFolders],
  );

  const totalHeight = nodes.length * ROW_HEIGHT;
  const firstVisible = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const lastVisible = Math.min(
    nodes.length,
    firstVisible + Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2,
  );
  const visibleNodes = nodes.slice(firstVisible, lastVisible);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      onScroll(el.scrollTop, el.clientHeight);
    },
    [onScroll],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    onScroll(containerRef.current.scrollTop, containerRef.current.clientHeight);
  }, [nodes.length, onScroll]);

  return (
    <div
      className="redis-key-list"
      ref={containerRef}
      onScroll={handleScroll}
      style={{ flex: 1, minHeight: "100px", overflow: "auto" }}
    >
      {nodes.length > 0 && (
        <div
          className="redis-key-list-window"
          style={{ position: "relative", height: totalHeight }}
        >
          {visibleNodes.map((node, index) => {
            const nodeIndex = firstVisible + index;
            return (
              <div
                key={node.key}
                className={`redis-tree-row${selectedKey === node.fullKey && !node.children ? " active" : ""}`}
                style={{
                  position: "absolute",
                  top: nodeIndex * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  paddingLeft: `${node.level * 14 + 6}px`,
                }}
                onClick={() => {
                  if (node.children) {
                    onToggleFolder(node.key);
                  } else {
                    onSelectKey(node.fullKey);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (node.children) {
                      onToggleFolder(node.key);
                    } else {
                      onSelectKey(node.fullKey);
                    }
                  }
                }}
              >
                <span className="redis-tree-icon">
                  {node.children
                    ? node.expanded
                      ? FOLDER_OPEN
                      : FOLDER_CLOSED
                    : ""}
                </span>
                <span
                  className={`redis-tree-name${node.children ? " folder" : ""}`}
                  title={node.children ? `${node.keyCount} keys` : undefined}
                >
                  {node.name}
                </span>
                {!node.children && (
                  <span className="redis-tree-meta">
                    <span>{node.type}</span>
                    <span>{node.ttlMs != null ? formatTtl(node.ttlMs) : ""}</span>
                  </span>
                )}
                {node.children && (
                  <span className="redis-tree-count">
                    {node.keyCount ?? 0}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {nodes.length === 0 && (
        <div className="muted redis-empty-keys">No keys found.</div>
      )}
    </div>
  );
}
