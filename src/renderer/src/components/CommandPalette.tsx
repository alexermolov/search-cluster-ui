import { useEffect, useMemo, useRef, useState } from "react";
import type {
  StoredKafkaConnection,
  KafkaTopicInfo,
  StoredRedisConnection,
} from "../../../shared/types";
import { AUTO_REFRESH_OPTIONS, useApp, type Tab } from "../store";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPalettePanelProps {
  commands: Command[];
  open: boolean;
  onClose: () => void;
}

export function CommandPalettePanel({
  commands,
  open,
  onClose,
}: CommandPalettePanelProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  if (!open) return null;

  const runSelected = () => {
    const cmd = filtered[selected];
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  return (
    <div
      className="palette-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette">
        <input
          ref={inputRef}
          className="input palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) =>
                Math.min(s + 1, Math.max(filtered.length - 1, 0)),
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runSelected();
            }
          }}
        />
        <div className="palette-list">
          {filtered.map((c, i) => (
            <div
              key={c.id}
              className={`palette-item${i === selected ? " selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => {
                onClose();
                c.run();
              }}
            >
              <span className="palette-label">{c.label}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="palette-empty">No matching commands</div>
          )}
        </div>
        <div className="palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

export function useElasticPaletteCommands(): Command[] {
  const setTab = useApp((s) => s.setTab);
  const refresh = useApp((s) => s.refreshCluster);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const setAutoRefreshSec = useApp((s) => s.setAutoRefreshSec);
  const autoRefreshSec = useApp((s) => s.autoRefreshSec);
  const connections = useApp((s) => s.connections);
  const activeId = useApp((s) => s.activeId);
  const selectConnection = useApp((s) => s.selectConnection);
  const openEditor = useApp((s) => s.openEditor);

  return useMemo<Command[]>(() => {
    const tabs: { id: Tab; label: string }[] = [
      { id: "overview", label: "Go to Overview" },
      { id: "indices", label: "Go to Indices" },
      { id: "query", label: "Go to Query" },
      { id: "shards", label: "Go to Shards" },
      { id: "snapshots", label: "Go to Snapshots" },
      { id: "schemas", label: "Go to Schemas" },
      { id: "settings", label: "Go to Settings" },
    ];
    const cmds: Command[] = [
      ...tabs.map((t) => ({
        id: `tab:${t.id}`,
        label: t.label,
        hint: "Tab",
        run: () => setTab(t.id),
      })),
      {
        id: "refresh",
        label: "Refresh cluster",
        hint: "Ctrl+R / F5",
        run: () => void refresh(),
      },
      {
        id: "theme",
        label: "Toggle dark / light theme",
        hint: "Theme",
        run: () => toggleTheme(),
      },
      ...AUTO_REFRESH_OPTIONS.map((sec) => ({
        id: `autorefresh:${sec}`,
        label: sec === 0 ? "Auto-refresh: off" : `Auto-refresh: every ${sec}s`,
        hint: sec === autoRefreshSec ? "current" : "Polling",
        run: () => setAutoRefreshSec(sec),
      })),
      {
        id: "conn:new",
        label: "Add connection…",
        hint: "Connection",
        run: () => openEditor(),
      },
      ...connections.map((c) => ({
        id: `conn:${c.id}`,
        label: `Switch to ${c.name}`,
        hint: c.id === activeId ? "active" : "Connection",
        run: () => void selectConnection(c.id),
      })),
    ];
    return cmds;
  }, [
    setTab,
    refresh,
    toggleTheme,
    setAutoRefreshSec,
    autoRefreshSec,
    connections,
    activeId,
    selectConnection,
    openEditor,
  ]);
}

export interface KafkaPaletteOptions {
  connections: StoredKafkaConnection[];
  activeId: string | null;
  onSelectConnection: (id: string) => void;
  viewMode: "topics" | "consumers";
  onSetViewMode: (mode: "topics" | "consumers") => void;
  topics: KafkaTopicInfo[];
  visibleTopics: KafkaTopicInfo[];
  selectedTopic: string;
  onRefresh: () => void;
  onNewConnection: () => void;
  onCreateTopic: () => void;
  onProduceMessage: () => void;
  onOpenTopicDetail: () => void;
  onCopyAllTopics: () => void;
  onCopyVisibleTopics: () => void;
  onBackToPicker?: () => void;
}

export function useKafkaPaletteCommands(
  options: KafkaPaletteOptions,
): Command[] {
  const toggleTheme = useApp((s) => s.toggleTheme);
  const {
    connections,
    activeId,
    onSelectConnection,
    viewMode,
    onSetViewMode,
    topics,
    selectedTopic,
    onRefresh,
    onNewConnection,
    onCreateTopic,
    onProduceMessage,
    onOpenTopicDetail,
    onCopyAllTopics,
    onCopyVisibleTopics,
    onBackToPicker,
  } = options;

  return useMemo<Command[]>(() => {
    const cmds: Command[] = [
      {
        id: "view:topics",
        label: "View: Topics",
        hint: "Tab",
        run: () => onSetViewMode("topics"),
      },
      {
        id: "view:consumers",
        label: "View: Consumer groups",
        hint: "Tab",
        run: () => onSetViewMode("consumers"),
      },
    ];

    if (activeId) {
      cmds.push({
        id: "refresh",
        label: "Refresh",
        hint: "Ctrl+R / F5",
        run: onRefresh,
      });
    }

    cmds.push({
      id: "theme",
      label: "Toggle dark / light theme",
      hint: "Theme",
      run: toggleTheme,
    });

    if (viewMode === "topics" && topics.length > 0) {
      cmds.push(
        {
          id: "copy-all-topics",
          label: "Copy all topic names",
          run: onCopyAllTopics,
        },
        {
          id: "copy-visible-topics",
          label: "Copy visible topic names",
          run: onCopyVisibleTopics,
        },
      );
    }

    if (viewMode === "topics") {
      cmds.push({
        id: "create-topic",
        label: "Create topic…",
        run: onCreateTopic,
      });
      if (selectedTopic) {
        cmds.push(
          {
            id: "produce",
            label: `Send event to ${selectedTopic}`,
            run: onProduceMessage,
          },
          {
            id: "topic-detail",
            label: `Open ${selectedTopic} details`,
            run: onOpenTopicDetail,
          },
        );
      }
    }

    cmds.push({
      id: "conn:new",
      label: "Add Kafka connection…",
      hint: "Connection",
      run: onNewConnection,
    });

    if (onBackToPicker) {
      cmds.push({
        id: "back:picker",
        label: "Back to product picker",
        hint: "Navigation",
        run: onBackToPicker,
      });
    }

    for (const c of connections) {
      cmds.push({
        id: `conn:${c.id}`,
        label: `Switch to ${c.name}`,
        hint: c.id === activeId ? "active" : "Connection",
        run: () => onSelectConnection(c.id),
      });
    }

    return cmds;
  }, [
    activeId,
    connections,
    onBackToPicker,
    onCopyAllTopics,
    onCopyVisibleTopics,
    onCreateTopic,
    onNewConnection,
    onOpenTopicDetail,
    onProduceMessage,
    onRefresh,
    onSelectConnection,
    onSetViewMode,
    selectedTopic,
    topics,
    toggleTheme,
    viewMode,
  ]);
}

export interface RedisPaletteOptions {
  connections: StoredRedisConnection[];
  activeId: string | null;
  onSelectConnection: (id: string) => void;
  tab: "keys" | "console" | "server";
  onSetTab: (tab: "keys" | "console" | "server") => void;
  onRefresh: () => void;
  onNewConnection: () => void;
  onLoadMoreKeys?: () => void;
  onClearConsole?: () => void;
  onFocusCommandInput?: () => void;
  onBackToPicker?: () => void;
}

export function useRedisPaletteCommands(
  options: RedisPaletteOptions,
): Command[] {
  const toggleTheme = useApp((s) => s.toggleTheme);
  const {
    connections,
    activeId,
    onSelectConnection,
    tab,
    onSetTab,
    onRefresh,
    onNewConnection,
    onLoadMoreKeys,
    onClearConsole,
    onFocusCommandInput,
    onBackToPicker,
  } = options;

  return useMemo<Command[]>(() => {
    const cmds: Command[] = [
      {
        id: "tab:keys",
        label: "Go to Keys",
        hint: "Tab",
        run: () => onSetTab("keys"),
      },
      {
        id: "tab:console",
        label: "Go to Console",
        hint: "Tab",
        run: () => onSetTab("console"),
      },
      {
        id: "tab:server",
        label: "Go to Server info",
        hint: "Tab",
        run: () => onSetTab("server"),
      },
    ];

    if (activeId) {
      cmds.push({
        id: "refresh",
        label: "Refresh",
        hint: "Ctrl+R / F5",
        run: onRefresh,
      });
      if (tab === "keys" && onLoadMoreKeys) {
        cmds.push({
          id: "load-more",
          label: "Load more keys",
          run: onLoadMoreKeys,
        });
      }
    }

    cmds.push({
      id: "theme",
      label: "Toggle dark / light theme",
      hint: "Theme",
      run: toggleTheme,
    });

    if (tab === "console") {
      if (onClearConsole) {
        cmds.push({
          id: "clear-console",
          label: "Clear console output",
          run: onClearConsole,
        });
      }
      if (onFocusCommandInput) {
        cmds.push({
          id: "focus-command",
          label: "Focus command input",
          run: onFocusCommandInput,
        });
      }
    }

    cmds.push({
      id: "conn:new",
      label: "Add Redis connection…",
      hint: "Connection",
      run: onNewConnection,
    });

    if (onBackToPicker) {
      cmds.push({
        id: "back:picker",
        label: "Back to product picker",
        hint: "Navigation",
        run: onBackToPicker,
      });
    }

    for (const c of connections) {
      cmds.push({
        id: `conn:${c.id}`,
        label: `Switch to ${c.name}`,
        hint: c.id === activeId ? "active" : "Connection",
        run: () => onSelectConnection(c.id),
      });
    }

    return cmds;
  }, [
    activeId,
    connections,
    onBackToPicker,
    onClearConsole,
    onFocusCommandInput,
    onLoadMoreKeys,
    onNewConnection,
    onRefresh,
    onSelectConnection,
    onSetTab,
    tab,
    toggleTheme,
  ]);
}

/**
 * Ctrl+K command palette: fuzzy-ish filter over app actions (tabs, refresh,
 * theme, auto-refresh, connections). Arrow keys + Enter, Esc closes.
 */
export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const commands = useElasticPaletteCommands();
  return (
    <CommandPalettePanel
      commands={commands}
      open={open}
      onClose={() => setOpen(false)}
    />
  );
}
