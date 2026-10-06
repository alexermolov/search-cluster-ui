import type { ElectronApi } from '../../shared/ipc'

export const api: ElectronApi = window.api

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
