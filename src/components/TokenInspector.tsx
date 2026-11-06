import { savings, toMarkdown, type Note } from '../deso'
import { useI18n } from '../i18n'

export default function TokenInspector({ note }: { note: Note }) {
  const { t: tr } = useI18n()
  const s = savings(note.content)
  const { md, kinds } = toMarkdown(note.content)
  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-auto">
      <div className="flex items-baseline gap-4">
        <span className="text-3xl font-semibold tracking-tight">−{s.pct}%</span>
        <span className="text-mut text-sm">{tr('tiSaved')} · .deso {s.d} · .md {s.m} · Δ {s.m - s.d}</span>
      </div>
      <table className="text-xs w-full max-w-xl">
        <thead className="text-dim text-left"><tr><th className="py-1 font-medium">{tr('tiConstruct')}</th><th className="font-medium">.deso</th><th className="font-medium">.md</th><th className="font-medium">{tr('savedCol')}</th></tr></thead>
        <tbody>
          {Object.entries(kinds).map(([k, v]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1.5 text-mut">{k}</td><td>{v.d}</td><td>{v.m}</td>
              <td className={v.m >= v.d ? 'text-fg' : 'text-rose-300'}>{v.m - v.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0 text-xs">
        {[['NanoMark .deso', note.content, 'text-fg'], ['Obsidian .md', md, 'text-mut']].map(([h, t, c]) => (
          <section key={h} className="border border-line rounded-lg bg-surface flex flex-col min-h-0 overflow-hidden">
            <header className="px-3 py-2 bg-panel border-b border-line text-mut">{h} <span className="text-dim">· {t.length} bytes</span></header>
            <pre className={`p-3 font-mono overflow-auto whitespace-pre-wrap ${c}`}>{t}</pre>
          </section>
        ))}
      </div>
      <p className="text-[10px] text-dim">{tr('tiEstimate')}</p>
    </div>
  )
}
