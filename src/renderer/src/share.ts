import { addToast } from './toasts';

export function encodeToBase64(obj: unknown): string {
  const json = JSON.stringify(obj);
  return btoa(unescape(encodeURIComponent(json)));
}

export function decodeFromBase64(base64: string): unknown {
  const json = decodeURIComponent(escape(atob(base64.trim())));
  return JSON.parse(json);
}

export async function shareConnection(connection: unknown): Promise<void> {
  try {
    const base64 = encodeToBase64(connection);
    await navigator.clipboard.writeText(base64);
    addToast('Connection config copied to clipboard', 'success');
  } catch {
    addToast('Failed to copy connection config', 'error');
  }
}
