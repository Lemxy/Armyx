export interface Note { name: string; content: string }

const LINK = /->?@([A-Za-z0-9_-]+)/g

export const links = (src: string) => [...new Set([...src.matchAll(LINK)].map((m) => m[1]))]
export const tags = (src: string) =>
  [...new Set([...src.matchAll(/(?:^|\s)#([A-Za-z][\w-]*)/gm)].map((m) => m[1]))]
export const title = (n: Note) => n.content.match(/^# (.+)$/m)?.[1] ?? n.name.toUpperCase()

// Heuristic BPE-like estimate (not an exact tokenizer): letter runs ~5 chars/token, digits 3/token, punct 2/token, newline 1.
// Mirrored in src-tauri/src/lib.rs `count_tokens`.
export const tokens = (s: string) =>
  (s.match(/[A-Za-z]+|\d{1,3}|\n|[^\sA-Za-z\d]{1,2}/g) ?? []).reduce(
    (n, t) => n + (/^[A-Za-z]/.test(t) ? Math.ceil(t.length / 5) : 1),
    0,
  )

export type Kind = 'props' | 'data' | 'todos' | 'links' | 'text'
export type Breakdown = Partial<Record<Kind, { d: number; m: number }>>

/** Convert NanoMark to the equivalent Obsidian Markdown, with per-construct token tallies. */
export function toMarkdown(src: string) {
  const kinds: Breakdown = {}
  const add = (k: Kind, d: string, m: string) => {
    const e = (kinds[k] ??= { d: 0, m: 0 })
    e.d += tokens(d)
    e.m += tokens(m)
  }
  const fm: string[] = []
  const body: string[] = []
  let inTable = false
  for (const line of src.split('\n')) {
    let m = line.match(/^\?([\w-]+):\s*(.*)$/)
    if (m) { fm.push(`${m[1]}: ${m[2]}`); add('props', line, ''); inTable = false; continue }
    m = line.match(/^!(\S+)\s+(.*)$/)
    if (m) {
      const row = (inTable ? '' : '| key | value |\n|---|---|\n') + `| ${m[1]} | ${m[2]} |`
      inTable = true
      body.push(row); add('data', line, row); continue
    }
    inTable = false
    let kind: Kind = 'text'
    let out = line
    const t = line.match(/^([+-])(?!>)(\S.*)$/)
    if (t) { out = `- [${t[1] === '+' ? 'x' : ' '}] ${t[2]}`; kind = 'todos' }
    out = out.replace(LINK, '[[$1]]')
    if (kind === 'text' && out !== line) kind = 'links'
    body.push(out); add(kind, line, out)
  }
  const front = fm.length ? `---\n${fm.join('\n')}\n---\n` : ''
  if (kinds.props) kinds.props.m = tokens(front)
  return { md: front + body.join('\n'), kinds }
}

export const savings = (src: string) => {
  const d = tokens(src), m = tokens(toMarkdown(src).md)
  return { d, m, pct: m ? Math.round((1 - d / m) * 100) : 0 }
}

const prop = (src: string, k: string) => src.match(new RegExp(String.raw`^\?${k}:\s*(.+)$`, 'm'))?.[1].trim()

/** How the agent should read `graphMap` (kept next to it so the two never drift apart). */
export const MAP_INTRO =
  'Project map, one line per file: `id path — about [exports] -> linked ids` (less important files: `id path — about`). ' +
  '`~` before a file in uses / used by = link guessed by symbol name, not an import. "Best matches" may follow with the closest files. ' +
  'If the map does not name the answer, search (Grep/Glob) or open the file; never guess a path.'

const MAP_BUDGET = 8000 // tokens, resent on every turn: half for full lines, half for shortened ones

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\d]/gu, '')
// camelCase / snake_case / kebab-case / paths all become plain lowercase terms; a light stem makes "emails" meet "email"
export const terms = (s: string) => (s.replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().match(/[\p{L}\d]+/gu) ?? []).map((w) => w.replace(/(?<=.{4})(ing|es|ed|s)$/, ''))
const DOC_W = 0.5 // comments and docstrings: weight 0.25-1 gave the same ranking on Django, so no tuning knob
const FIELDS = [['path', 3], ['symbols', 3], ['exports', 2], ['keywords', 0.3], ['doc', DOC_W], ['about', 1]] as const
// words in a question that name a file type, and file types that are rarely the answer to "which file does X"
const KINDS: Record<string, string> = { rust: 'rs', python: 'py', tsx: 'tsx', react: 'tsx', typescript: 'ts', javascript: 'js', toml: 'toml', markdown: 'md', css: 'css', html: 'html' }
const MINOR = new Set(['toml', 'yml', 'yaml', 'md', 'css', 'html', 'lock', 'json'])

const MAP_LINKS = 5 // links shown per full line: a hub's long list costs more than it tells

/**
 * How well each note matches `focus`: BM25 over weighted fields (path, symbols, exports, keywords, about), so a rare word in a
 * symbol beats a common word in a description. Words naming a file type or a top-level folder ("Rust file", "server") steer the
 * result, and config/test files lose unless asked for.
 */
const focusScore = (notes: Note[], focus: string) => {
  const q = [...new Set(terms(focus).filter((w) => w.length > 2))]
  const score = new Map<string, number>()
  if (!q.length) return score
  const tf = notes.map((n) => {
    const m = new Map<string, number>()
    let len = 0
    for (const [k, w] of FIELDS) for (const t of terms(prop(n.content, k) ?? '')) { m.set(t, (m.get(t) ?? 0) + w); len += w }
    for (const t of terms((prop(n.content, 'path') ?? '').split('/').pop()!)) m.set(t, (m.get(t) ?? 0) + 2) // the file name says most
    return { m, len: len || 1, hay: squash(FIELDS.map(([k]) => prop(n.content, k) ?? '').join(' ')) }
  })
  const avg = tf.reduce((a, d) => a + d.len, 0) / notes.length
  // exact term, or (for words of 4+ letters) a substring of the squashed text: "email" finds "e-mail"
  const freq = (d: (typeof tf)[number], w: string) => d.m.get(w) ?? (w.length > 3 && d.hay.includes(w) ? 0.7 : 0)
  const bm = new Map<string, number>()
  tf.forEach((d, i) => bm.set(notes[i].name, 0))
  for (const w of q) {
    const df = tf.filter((d) => freq(d, w) > 0).length
    if (!df || df > notes.length * 0.4) continue
    const idf = Math.log(1 + (notes.length - df + 0.5) / (df + 0.5))
    tf.forEach((d, i) => { const f = freq(d, w); if (f) bm.set(notes[i].name, bm.get(notes[i].name)! + (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avg))) })
  }
  const kinds = new Set(q.flatMap((w) => KINDS[w] ?? []))
  const dirs = new Map(notes.map((n) => [n.name, terms((prop(n.content, 'path') ?? '').split('/')[0])]))
  const asked = new Set(q.filter((w) => [...dirs.values()].some((t) => t.includes(w))))
  const wantsTest = q.some((w) => w.startsWith('test'))
  notes.forEach((n) => {
    let s = bm.get(n.name)!
    if (s <= 0) return
    const ext = (prop(n.content, 'path') ?? '').split('.').pop() ?? ''
    if (kinds.size) s *= kinds.has(ext) ? 1.6 : 0.7
    else if (MINOR.has(ext) && !q.includes(ext)) s *= 0.5
    if (asked.size) s *= dirs.get(n.name)!.some((t) => asked.has(t)) ? 1.4 : 0.8
    if (!wantsTest && /test|spec/i.test(n.name)) s *= 0.6
    score.set(n.name, s)
  })
  return score
}

/**
 * The notes that best match `focus`, one plain line each (real paths, no ids). Send it after a static `graphMap(notes)`:
 * the map stays identical between questions, so the API serves it from the prompt cache at a fraction of the price.
 */
export const topHits = (notes: Note[], focus: string, k = 12, spread = DIVERSE) => diverse(scoredHits(notes, focus).map((h) => h.note), k, undefined, spread)
  .map((n, i) => {
    // for the best few: which files this one uses (symbols it takes from them) and which files use it, so an agent can follow a bug
    // to its cause without searching the project. Links named in the source come first; a `~` marks one guessed by symbol name.
    const certain = (l: string[]) => [...l].sort((a, b) => Number(a.startsWith('~')) - Number(b.startsWith('~')))
    const calls = i < 3 ? certain(prop(n.content, 'calls')?.split(/, (?=[^,]*\()/) ?? []).slice(0, 3).join(', ') : undefined
    const callers = i < 3 ? certain(prop(n.content, 'callers')?.split(', ') ?? []).slice(0, i ? 4 : 8).join(', ') : undefined
    return [prop(n.content, 'path') ?? title(n), prop(n.content, 'about')?.slice(0, 70)].filter(Boolean).join(' — ') + (calls ? ` | uses ${calls}` : '') + (callers ? ` | used by ${callers}` : '')
  }).join('\n')

/**
 * Best-first notes, but no folder takes more than `per` places while others are waiting, so one busy folder (generated code,
 * a test suite) cannot fill the whole list. `topHits(.., false)` turns it off (the benchmark compares both).
 */
export const DIVERSE = true
export const diverse = (ranked: Note[], k: number, per = Math.max(2, Math.ceil(k / 3)), on = DIVERSE) => {
  if (!on) return ranked.slice(0, k)
  const dir = (n: Note) => (prop(n.content, 'path') ?? '').split('/').slice(0, -1).join('/')
  const used = new Map<string, number>(), picked: Note[] = [], later: Note[] = []
  for (const n of ranked) {
    if (picked.length >= k) break
    const d = dir(n), c = used.get(d) ?? 0
    if (c < per) { used.set(d, c + 1); picked.push(n) } else later.push(n)
  }
  return picked.concat(later).slice(0, k)
}

/** Notes matching `focus`, best first, with their scores (a big gap between the first two means the first is a safe answer). */
export const scoredHits = (notes: Note[], focus: string) => {
  const have = new Set(notes.map((n) => n.name))
  const out = new Map(notes.map((n) => [n.name, links(n.content).filter((l) => have.has(l) && l !== n.name)]))
  const score = focusScore(notes, focus)
  return notes.filter((n) => (score.get(n.name) ?? 0) > 0).map((note) => ({ note, score: score.get(note.name)! })).sort((a, b) => b.score - a.score)
}

/**
 * Compact map of the vault for an agent. Short numeric ids instead of long note names (links were most of the size),
 * and a token budget: the best-ranked notes get a full line, the next ones a short `id path — about` line, the rest a count.
 * Rank = how well a note matches `focus` (rare words weigh more) + links + size, so leaf files are not buried by hubs.
 */
export const graphMap = (notes: Note[], budget = MAP_BUDGET, focus = '') => {
  const have = new Set(notes.map((n) => n.name))
  const out = new Map(notes.map((n) => [n.name, links(n.content).filter((l) => have.has(l) && l !== n.name)]))
  const degree = new Map(notes.map((n) => [n.name, out.get(n.name)!.length]))
  for (const to of out.values()) for (const t of to) degree.set(t, degree.get(t)! + 1)

  const score = focusScore(notes, focus)
  const size = new Map(notes.map((n) => [n.name, Math.log2(1 + Number(prop(n.content, 'lines') ?? 0) / 50)]))
  const rank = (n: Note) => (score.get(n.name) ?? 0) * 10 + degree.get(n.name)! + size.get(n.name)!
  const ranked = [...notes].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name))

  const path = (n: Note) => prop(n.content, 'path') ?? title(n)
  const about = (n: Note, k: number) => prop(n.content, 'about')?.slice(0, k)
  const picked: Note[] = [], full = new Set<string>()
  let used = 0, short = 0
  for (const n of ranked) {
    const cost = tokens(n.name + path(n) + (about(n, 70) ?? '') + (prop(n.content, 'exports') ?? '')) + Math.min(out.get(n.name)!.length, MAP_LINKS) * 2 + 4
    if (used + cost <= budget / 2 || !picked.length) { used += cost; full.add(n.name) }
    else {
      const c = tokens(n.name + path(n) + (about(n, 50) ?? '')) + 4
      if (short + c > budget / 2) continue // a cheaper note further down may still fit
      short += c
    }
    picked.push(n)
  }
  picked.sort((a, b) => a.name.localeCompare(b.name))
  const id = new Map(picked.map((n, i) => [n.name, i + 1]))

  const lines = picked.map((n) => {
    if (!full.has(n.name)) return `${id.get(n.name)} ${[path(n), about(n, 50)].filter(Boolean).join(' — ')}`
    const to = out.get(n.name)!.filter((l) => id.has(l)).map((l) => id.get(l)).slice(0, MAP_LINKS)
    const exp = prop(n.content, 'exports')?.split(', ').slice(0, 5).join(', ')
    const what = [path(n), about(n, 70), exp && `[${exp}]`].filter(Boolean).join(' — ')
    return `${id.get(n.name)} ${what}${to.length ? ` -> ${to.join(',')}` : ''}`
  })
  if (picked.length < notes.length) lines.push(`(${notes.length - picked.length} less connected notes omitted: search the project for them)`)
  return lines.join('\n')
}

/**
 * For a big project: the best matches only when the search is sure (the best hit scores at least 1.5x the second), otherwise
 * nothing, so the agent searches as it always did and cannot be steered wrong or made to pay for a map it does not need.
 * Measured on Django: at 1.5 the best hit was right 17 of 17 times for questions quoting the code, but only 1 of 4 for rewritten ones.
 */
export const SURE = 1.5
export const sureHits = (notes: Note[], focus: string, k = 5) => {
  const h = scoredHits(notes, focus)
  return h.length && (h.length < 2 || h[0].score / h[1].score >= SURE) ? topHits(notes, focus, k) : ''
}

/** Folder outline (two levels, largest first): a map for projects too big for one, a few hundred tokens instead of 8,000. */
export const outline = (notes: Note[], max = 30) => {
  const dirs = new Map<string, number>()
  for (const n of notes) { const d = (prop(n.content, 'path') ?? '').split('/').slice(0, -1).slice(0, 2).join('/') || '.'; dirs.set(d, (dirs.get(d) ?? 0) + 1) }
  return [...dirs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([d, c]) => `${d}/ ${c} files`).join('\n')
}

/**
 * The map to send for a project of this size. Measured: a small project (about 50 files) gets the same saving from a 2.5k-token map
 * as from 8k, and a big one (3,400 files) paid 7-23% more with the 8k map than without any, so past SMALL_PROJECT files only the
 * outline and the best matches are sent.
 */
export const SMALL_PROJECT = 300

/** Version of the note format the scanner writes (`?schema` in project-map); older graphs lack the `~` marks. Keep equal to SCHEMA in scan.rs. */
export const SCHEMA = 2
export const staleSchema = (notes: Note[]) => { const m = notes.find((n) => n.name === 'project-map'); return !!m && Number(prop(m.content, 'schema') ?? 0) < SCHEMA }
export const mapFor = (notes: Note[]) => notes.length <= SMALL_PROJECT ? graphMap(notes, 2500) : `Folders (the project has ${notes.length} files, too many to list; the best matches below are the ranking for this question):
${outline(notes)}`

/** For a scanned project: tokens of the graph map vs a rough estimate of the source it stands in for (~4 bytes/token). */
export const mapVsSource = (notes: Note[]) => {
  const bytes = Number(prop(notes.find((n) => n.name === 'project-map')?.content ?? '', 'source_bytes'))
  return bytes > 0 ? { map: tokens(graphMap(notes)), src: Math.round(bytes / 4) } : null
}
