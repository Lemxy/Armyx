const COL = 320, ROW = 150, ROWS = 8
export type P = { x: number; y: number }
export type Edge = { from: string; to: string }

/** Left-to-right layers: each note sits one column right of the deepest note linking to it. */
export function layout(names: string[], edges: Edge[], tree = false): Record<string, P> {
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
    if (tree) { // family tree: one generation per row, parents above children
      layer.forEach((n, j) => { row.set(n, j); out[n] = { x: (j - (layer.length - 1) / 2) * 260, y: x } })
      x += 200
      continue
    }
    const h = Math.min(layer.length, ROWS) * ROW
    layer.forEach((n, j) => {
      row.set(n, j)
      out[n] = { x: x + Math.floor(j / ROWS) * COL, y: (j % ROWS) * ROW - h / 2 }
    })
    x += Math.ceil(layer.length / ROWS) * COL + 60
  }
  return out
}

/** Label propagation: groups of densely linked notes, biggest first, each named by its most-linked member. Isolated notes are left out. */
export function communities(names: string[], edges: Edge[]): { hub: string; members: string[] }[] {
  const nb = new Map(names.map((n) => [n, [] as string[]]))
  for (const e of edges) { nb.get(e.from)?.push(e.to); nb.get(e.to)?.push(e.from) }
  const label = new Map(names.map((n) => [n, n]))
  for (let it = 0; it < 15; it++) { // fixed order + tie-break by name keeps it deterministic; shortcut: no oscillation guard beyond 15 rounds
    let changed = false
    for (const n of [...names].sort()) {
      const c = new Map<string, number>()
      // a neighbour's vote counts more the more neighbours they share, so a lone bridge link loses to a tight group
      const mine = new Set(nb.get(n))
      for (const m of nb.get(n)!) c.set(label.get(m)!, (c.get(label.get(m)!) ?? 0) + 1 + nb.get(m)!.filter((x) => mine.has(x)).length)
      const best = [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
      // switch only for a strictly bigger majority, so a lone bridge cannot merge two groups
      if (best && best[0] !== label.get(n) && best[1] > (c.get(label.get(n)!) ?? 0)) { label.set(n, best[0]); changed = true }
    }
    if (!changed) break
  }
  const groups = new Map<string, string[]>()
  for (const n of names) groups.set(label.get(n)!, [...(groups.get(label.get(n)!) ?? []), n])
  const deg = (n: string) => nb.get(n)!.length
  return [...groups.values()].filter((g) => g.length > 1)
    .map((g) => ({ hub: [...g].sort((a, b) => deg(b) - deg(a) || a.localeCompare(b))[0], members: g }))
    .sort((a, b) => b.members.length - a.members.length || a.hub.localeCompare(b.hub))
}
