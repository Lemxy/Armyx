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

/** Compact map of the whole vault for an agent: one line per note, saying what it is, where it lives and what it links to. */
export const graphMap = (notes: Note[]) => {
  const have = new Set(notes.map((n) => n.name))
  return notes.map((n) => {
    const to = links(n.content).filter((l) => have.has(l) && l !== n.name)
    const what = [prop(n.content, 'path') ?? title(n), prop(n.content, 'about'), prop(n.content, 'exports') && `[${prop(n.content, 'exports')}]`].filter(Boolean).join(' — ')
    return `${n.name}: ${what}${to.length ? ` -> ${to.join(',')}` : ''}`
  }).join('\n')
}

/** For a scanned project: tokens of the graph map vs a rough estimate of the source it stands in for (~4 bytes/token). */
export const mapVsSource = (notes: Note[]) => {
  const bytes = Number(prop(notes.find((n) => n.name === 'project-map')?.content ?? '', 'source_bytes'))
  return bytes > 0 ? { map: tokens(graphMap(notes)), src: Math.round(bytes / 4) } : null
}
