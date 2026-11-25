const LAST_ACTIVE_ID_KEY = "ui.lastActiveId";

export type Product = "search" | "kafka" | "redis";

export function readLastActiveId(product: Product): string | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_ID_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string | undefined>;
    return map[product] ?? null;
  } catch {
    return null;
  }
}

export function writeLastActiveId(product: Product, id: string | null): void {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_ID_KEY);
    const map = raw
      ? (JSON.parse(raw) as Record<string, string | undefined>)
      : {};
    if (id) {
      map[product] = id;
    } else {
      delete map[product];
    }
    localStorage.setItem(LAST_ACTIVE_ID_KEY, JSON.stringify(map));
  } catch {
    // Private mode etc. — just skip persistence.
  }
}
