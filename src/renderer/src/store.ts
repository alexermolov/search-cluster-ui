import { create } from 'zustand'
import type { SaveConnectionInput } from '../../shared/ipc'
import type { IndexInfo, Overview, StoredConnection } from '../../shared/types'
import { api, errorMessage } from './api'

export type Tab = 'overview' | 'indices' | 'query' | 'shards' | 'snapshots' | 'schemas' | 'settings'
export type Theme = 'dark' | 'light'

const THEME_KEY = 'ui.theme'
const AUTOREFRESH_KEY = 'ui.autoRefreshSec'

export const AUTO_REFRESH_OPTIONS = [0, 5, 10, 15, 30] as const

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function readAutoRefreshSec(): number {
  try {
    const raw = Number(localStorage.getItem(AUTOREFRESH_KEY))
    return AUTO_REFRESH_OPTIONS.includes(raw as (typeof AUTO_REFRESH_OPTIONS)[number]) ? raw : 0
  } catch {
    return 0
  }
}

/** Abort/switch errors are expected noise, not user-facing failures. */
export function isAbortedError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'AbortedError')
}

interface AppStore {
  connections: StoredConnection[]
  activeId: string | null

  tab: Tab
  overview: Overview | null
  /** Timestamp (ms) of the last successful overview fetch; null — not loaded yet. */
  overviewUpdatedAt: number | null
  indices: IndexInfo[]
  filter: string
  /** null — index list shown; otherwise the index opened in the fullscreen view. */
  selectedIndex: string | null
  /** Incremented to trigger a reload of the open index detail view. */
  indexReloadTick: number
  loadingCluster: boolean
  error: string | null

  /** null — editor closed; otherwise the connection being edited (null = new). */
  editor: { connection: StoredConnection | null } | null

  theme: Theme
  autoRefreshSec: number
  paletteOpen: boolean

  init(): Promise<void>
  selectConnection(id: string): Promise<void>
  refreshCluster(): Promise<void>
  /** Silent background refresh of the overview only (auto-polling). */
  pollOverview(): Promise<void>
  /** Bump the reload tick so the open index detail view refetches its data. */
  reloadIndexDetail(): void
  setTab(tab: Tab): void
  setFilter(filter: string): void
  openIndex(name: string): void
  closeIndex(): void
  openEditor(connection?: StoredConnection): void
  closeEditor(): void
  saveConnection(input: SaveConnectionInput): Promise<void>
  removeConnection(id: string): Promise<void>
  setTheme(theme: Theme): void
  toggleTheme(): void
  setAutoRefreshSec(sec: number): void
  setPaletteOpen(open: boolean): void
}

async function loadCluster(
  id: string,
  requestId: string,
): Promise<Pick<AppStore, 'overview' | 'indices'>> {
  const [overview, indices] = await Promise.all([
    api.fetchOverview(id, requestId),
    api.fetchIndices(id, requestId),
  ])
  return { overview, indices }
}

let requestSeq = 0

export const useApp = create<AppStore>((set, get) => {
  /** RequestId of the in-flight foreground cluster load; cancelled on switch/refresh. */
  let activeRequestId: string | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function schedulePoll(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    const sec = get().autoRefreshSec
    if (sec > 0) pollTimer = setInterval(() => void get().pollOverview(), sec * 1000)
  }

  return {
    connections: [],
    activeId: null,
    tab: 'overview',
    overview: null,
    overviewUpdatedAt: null,
    indices: [],
    filter: '',
    selectedIndex: null,
    indexReloadTick: 0,
    loadingCluster: false,
    error: null,
    editor: null,
    theme: readTheme(),
    autoRefreshSec: readAutoRefreshSec(),
    paletteOpen: false,

    init: async () => {
      document.documentElement.dataset.theme = get().theme
      schedulePoll()
      try {
        const connections = await api.listConnections()
        set({ connections })
        if (connections[0]) await get().selectConnection(connections[0].id)
      } catch (e) {
        set({ error: errorMessage(e) })
      }
    },

    selectConnection: async (id) => {
      if (activeRequestId) api.cancelRequest(activeRequestId)
      const requestId = `req-${++requestSeq}`
      activeRequestId = requestId
      set({
        activeId: id,
        overview: null,
        overviewUpdatedAt: null,
        indices: [],
        filter: '',
        selectedIndex: null,
        error: null,
        loadingCluster: true,
        tab: 'overview',
      })
      try {
        const data = await loadCluster(id, requestId)
        // user switched again meanwhile
        if (get().activeId !== id || activeRequestId !== requestId) return
        set({ ...data, loadingCluster: false, overviewUpdatedAt: Date.now() })
      } catch (e) {
        if (get().activeId !== id || activeRequestId !== requestId || isAbortedError(e)) return
        set({ error: errorMessage(e), loadingCluster: false })
      }
    },

    refreshCluster: async () => {
      const id = get().activeId
      if (!id || get().loadingCluster) return
      // An open index view refreshes its own details alongside the cluster data.
      if (get().selectedIndex !== null) get().reloadIndexDetail()
      if (activeRequestId) api.cancelRequest(activeRequestId)
      const requestId = `req-${++requestSeq}`
      activeRequestId = requestId
      set({ loadingCluster: true, error: null })
      try {
        const data = await loadCluster(id, requestId)
        if (get().activeId !== id || activeRequestId !== requestId) return
        set({ ...data, loadingCluster: false, overviewUpdatedAt: Date.now() })
      } catch (e) {
        if (get().activeId !== id || activeRequestId !== requestId || isAbortedError(e)) return
        set({ error: errorMessage(e), loadingCluster: false })
      }
    },

    pollOverview: async () => {
      const id = get().activeId
      if (!id || get().loadingCluster) return
      const requestId = `poll-${++requestSeq}`
      try {
        const overview = await api.fetchOverview(id, requestId)
        if (get().activeId !== id) return
        set({ overview, overviewUpdatedAt: Date.now() })
      } catch {
        // Silent: polling failures keep the last known state; a manual
        // refresh will surface real errors.
      }
    },

    reloadIndexDetail: () => set({ indexReloadTick: get().indexReloadTick + 1 }),

    setTab: (tab) => set({ tab }),
    setFilter: (filter) => set({ filter }),

    openIndex: (name) => set({ selectedIndex: name }),
    closeIndex: () => set({ selectedIndex: null }),

    openEditor: (connection) => set({ editor: { connection: connection ?? null } }),
    closeEditor: () => set({ editor: null }),

    saveConnection: async (input) => {
      const saved = await api.saveConnection(input)
      const connections = await api.listConnections()
      set({ connections })
      await get().selectConnection(saved.id)
    },

    removeConnection: async (id) => {
      await api.deleteConnection(id)
      const connections = await api.listConnections()
      const nextActive = get().activeId === id ? (connections[0]?.id ?? null) : get().activeId
      set({ connections })
      if (nextActive) {
        await get().selectConnection(nextActive)
      } else {
        set({ activeId: null, overview: null, indices: [], error: null })
      }
    },

    setTheme: (theme) => {
      set({ theme })
      document.documentElement.dataset.theme = theme
      try {
        localStorage.setItem(THEME_KEY, theme)
      } catch {
        // Private mode etc. — theme just won't persist.
      }
    },

    toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

    setAutoRefreshSec: (sec) => {
      set({ autoRefreshSec: sec })
      try {
        localStorage.setItem(AUTOREFRESH_KEY, String(sec))
      } catch {
        // Won't persist — still applies for this session.
      }
      schedulePoll()
    },

    setPaletteOpen: (open) => set({ paletteOpen: open }),
  }
})
