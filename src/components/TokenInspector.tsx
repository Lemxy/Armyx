import { savings, toMarkdown, type Note } from '../deso'
import { useI18n } from '../i18n'

/** Share of the source that the agent does not have to read: 1 − map/source, never shown as a flat 100. */
const mapPct = ({ map, src }: { map: number; src: number }) => (src > 0 ? Math.min(99.9, Math.round((1 - map / src) * 1000) / 10) : 0)

export default function TokenInspector({ note, scanned }: { note: Note; scanned: { map: number; src: number } | null }) {
  const { t: tr } = useI18n()
  const s = savings(note.content)
  const { md, kinds } = toMarkdown(note.content)
  const stat = 'text-micro text-dim tabular-nums'
  return (
    <div className="h-full flex flex-col pt-8 pb-6 px-8 gap-8 overflow-auto">
      <div className="flex items-end gap-12 flex-wrap anim-rise">
        {scanned && (
          <div className="flex flex-col gap-2">
            <span className="font-serif text-display font-medium text-accent tabular-nums">−{mapPct(scanned)}%</span>
            <span className={stat}>map {scanned.map} vs source {scanned.src} tok · {scanned.src - scanned.map} {tr('tiSaved')}</span>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <span className={`font-serif font-medium tabular-nums ${scanned ? 'text-[36px] leading-none text-mut' : 'text-display text-accent'}`}>−{s.pct}%</span>
          <span className={stat}>.deso {s.d} vs .md {s.m} tok · {s.m - s.d} {tr('tiSaved')}</span>
        </div>
      </div>
      <div className="max-w-2xl rounded-2xl border border-line bg-surface px-5 py-3 anim-rise" style={{ animationDelay: '60ms' }}>
        <table className="text-sm w-full tabular-nums">
          <thead className="text-dim text-micro text-right"><tr><th className="py-2 font-normal text-left">{tr('tiConstruct')}</th><th className="font-normal">.deso</th><th className="font-normal">.md</th><th className="font-normal">{tr('savedCol')}</th><th className="w-36" /></tr></thead>
          <tbody>
            {Object.entries(kinds).map(([k, v]) => {
              const max = Math.max(v.d, v.m, 1)
              return (
                <tr key={k} className="border-t border-line text-right">
                  <td className="py-2.5 text-mut text-left capitalize">{k}</td><td>{v.d}</td><td className="text-mut">{v.m}</td>
                  <td className={v.m >= v.d ? 'text-accent' : 'text-status-err'}>{v.m - v.d}</td>
                  <td className="pl-4">
                    <div className="h-1 rounded-full bg-accent" title={`.deso ${v.d}`} style={{ width: `${(v.d / max) * 100}%`, transition: 'width .6s var(--ease)' }} />
                    <div className="h-1 mt-1 rounded-full bg-line2" title={`.md ${v.m}`} style={{ width: `${(v.m / max) * 100}%`, transition: 'width .6s var(--ease)' }} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-[14rem] anim-rise" style={{ animationDelay: '120ms' }}>
        {[['Nanomark', '.deso', note.content, 'text-fg'], ['Obsidian', '.md', md, 'text-mut']].map(([h, ext, t, c]) => (
          <section key={h} className="rounded-2xl border border-line bg-surface flex flex-col min-h-0 overflow-hidden">
            <header className="px-5 pt-4 pb-2 flex items-baseline gap-2">
              <span className="font-serif text-lg font-semibold">{h}</span><span className="text-micro text-dim">{ext} · {t.length} bytes</span>
            </header>
            <pre className={`px-5 pb-5 font-mono text-[12px] leading-5 overflow-auto whitespace-pre-wrap ${c}`}>{t}</pre>
          </section>
        ))}
      </div>
      <p className="text-micro text-dim">{tr('tiEstimate')}</p>
    </div>
  )
}
