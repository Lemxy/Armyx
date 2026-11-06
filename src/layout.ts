const COL = 320, ROW = 150, ROWS = 8
export type P = { x: number; y: number }
export type Edge = { from: string; to: string }

/** Left-to-right layers: each note sits one column right of the deepest note linking to it. */
export function layout(names: string[], edges: Edge[]): Record<string, P> {
  const parents = new Map(names.map((n) => [n, [] as string[]]))
  for (const e of edges) parents.get(e.to)?.push(e.from)
  const kids = new Map(names.map((n) => [n, [] as string[]]))
  for (const e of edges) kids.get(e.from)?.push(e.to)
  // forward walk from roots; a link back into the current path closes a cycle and is skipped
  const depth = new Map<string, number>()
  const path = new Set<string>()
  const walk = (n: string, d: number) => {
    if (path.has(n) || (depth.get(n) ?? -1) >= d) return
    depth.set(n, d)
    path.add(n)
    kids.get(n)!.forEach((k) => walk(k, d + 1))
    path.delete(n)
  }
  names.filter((n) => !parents.get(n)!.length).forEach((n) => walk(n, 0))
  names.forEach((n) => depth.has(n) || walk(n, 0)) // pure cycles with no root

  const layers: string[][] = []
  for (const n of names) (layers[depth.get(n)!] ??= []).push(n)
  const out: Record<string, P> = {}
  const row = new Map<string, number>()
  let x = 0
  for (const layer of layers.filter(Boolean)) {
    // order by average row of parents so links cross as little as possible
    const bary = (n: string) => { const r = parents.get(n)!.filter((p) => row.has(p)).map((p) => row.get(p)!); return r.length ? r.reduce((a, b) => a + b) / r.length : Infinity }
    layer.sort((a, b) => bary(a) - bary(b) || a.localeCompare(b))
    const h = Math.min(layer.length, ROWS) * ROW
    layer.forEach((n, j) => {
      row.set(n, j)
      out[n] = { x: x + Math.floor(j / ROWS) * COL, y: (j % ROWS) * ROW - h / 2 }
    })
    x += Math.ceil(layer.length / ROWS) * COL + 60
  }
  return out
}
