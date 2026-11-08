// API keys live only in this app's local storage (never in a project folder or exported notes).
// shortcut: plain localStorage, not an OS keychain; upgrade if keys must survive a webview reset or be encrypted.
const K = 'desovault.keys'
const all = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(K) ?? '{}') } catch { return {} } }
export const getKey = (id: string) => all()[id] ?? ''
export const setKey = (id: string, v: string) => localStorage.setItem(K, JSON.stringify({ ...all(), [id]: v.trim() }))
