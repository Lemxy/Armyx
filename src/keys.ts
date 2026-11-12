// API keys live in the operating system's keychain on the desktop (Windows Credential Manager, macOS Keychain, Secret Service), one
// entry holding all of them; never in a project folder or exported notes. getKey stays synchronous: `loadKeys()` fills a cache once at
// start. In the browser (no keychain) they stay in localStorage, and so do they if the keychain is unavailable.
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './vault'

const K = 'desovault.keys'
const local = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(K) ?? '{}') } catch { return {} } }
let cache: Record<string, string> = {}
let keychain = false

const save = () => (keychain ? invoke<void>('keys_save', { json: JSON.stringify(cache) }) : Promise.resolve(void localStorage.setItem(K, JSON.stringify(cache))))

/** Call once before the app renders. Keys saved by an older version in localStorage move into the keychain, then are removed. */
export async function loadKeys() {
  if (inTauri) {
    try { cache = JSON.parse(await invoke<string>('keys_load')); keychain = true } catch (e) { console.error('keychain unavailable, keys stay in local storage:', e) }
  }
  if (!keychain) { cache = local(); return }
  const old = local()
  if (Object.keys(old).length) { cache = { ...old, ...cache }; await save(); localStorage.removeItem(K) }
}

export const getKey = (id: string) => cache[id] ?? ''
let timer: ReturnType<typeof setTimeout> | undefined
export const setKey = (id: string, v: string) => {
  cache = { ...cache, [id]: v.trim() }
  subs.forEach((f) => f())
  clearTimeout(timer) // typing writes once, not once per letter
  timer = setTimeout(() => save().catch(console.error), 400)
}
const subs = new Set<() => void>()
/** Runs `f` after any key changes; returns the unsubscribe. */
export const onKeys = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
