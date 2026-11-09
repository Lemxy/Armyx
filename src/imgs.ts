// Generated pictures are too big for localStorage (a few fill it), so chats keep only an id and the picture lives in IndexedDB.
// shortcut: pictures of a deleted or cleared chat stay in the store; add a sweep when it grows.
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('desovault-images', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('i')
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})
const tx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open()
  return new Promise<T>((res, rej) => { const q = f(db.transaction('i', mode).objectStore('i')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) })
}
export const imgId = () => Math.random().toString(36).slice(2, 12)
/** Stores a data: URL under `id` (fire and forget: a failed save only means the picture is gone after a restart). */
export const putImg = (id: string, data: string) => { tx('readwrite', (s) => s.put(data, id)).catch(console.error) }
export const getImg = (id: string) => tx<string | undefined>('readonly', (s) => s.get(id))
