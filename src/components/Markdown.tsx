import { Fragment, type ReactNode } from 'react'

// Tiny Markdown subset for agent replies: fences, headings, lists, **bold**, `code`. Built as React nodes, never innerHTML.
// shortcut: no tables/links/nested lists; swap in a real parser if replies need them.
const inline = (s: string): ReactNode[] =>
  s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith('**') && p.length > 4 ? <strong key={i} className="font-semibold text-fg">{p.slice(2, -2)}</strong>
    : p.startsWith('`') && p.length > 2 ? <code key={i} className="px-1 py-px rounded-[2px] bg-field border border-line font-mono text-micro text-fg">{p.slice(1, -1)}</code>
    : <Fragment key={i}>{p}</Fragment>)

export default function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.trimStart().startsWith('```')) {
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].trimStart().startsWith('```'); i++) code.push(lines[i])
      out.push(<pre key={i} className="p-2.5 rounded-[2px] bg-field border border-line2 overflow-x-auto font-mono text-micro leading-5 text-mut">{code.join('\n')}</pre>)
      continue
    }
    const h = l.match(/^#{1,4}\s+(.*)/)
    const li = l.match(/^\s*(?:[-*]|(\d+)[.)])\s+(.*)/)
    if (h) out.push(<h4 key={i} className="mt-1 font-serif font-semibold text-fg tracking-tight">{inline(h[1])}</h4>)
    else if (li) out.push(
      <div key={i} className="flex gap-2 pl-1"><span className="text-dim shrink-0 w-4 text-right">{li[1] ? `${li[1]}.` : '–'}</span><span>{inline(li[2])}</span></div>)
    else if (l.trim()) out.push(<p key={i}>{inline(l)}</p>)
  }
  return <div className="flex flex-col gap-2 font-sans text-sm leading-relaxed text-fg break-words">{out}</div>
}
