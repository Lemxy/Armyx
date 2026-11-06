import { savings, toMarkdown, type Note } from '../deso'
import { useI18n } from '../i18n'

/** Share of the source that the agent does not have to read: 1 − map/source, never shown as a flat 100. */
const mapPct = ({ map, src }: { map: number; src: number }) => (src > 0 ? Math.min(99.9, Math.round((1 - map / src) * 1000) / 10) : 0)

export default function TokenInspector({ note, scanned }: { note: Note; scanned: { map: number; src: number } | null }) {
  const { t: tr } = useI18n()
  const s = savings(note.content)
  const { md, kinds } = toMarkdown(note.content)
  return (
    <div className="h-full flex flex-col pt-5 pb-4 px-6 gap-5 overflow-auto font-mono">
      {scanned && (
        <div className="flex flex-col gap-1.5">
          <span className="text-6xl font-mono text-accent font-light tracking-tight tabular-nums">−{mapPct(scanned)}%</span>
          <span className="text-micro uppercase tracking-wider text-dim tabular-nums">MAP {scanned.map} TOK vs SRC {scanned.src} TOK → Δ {scanned.src - scanned.map} TOK {tr('tiSaved')}</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className={`font-mono tracking-tight tabular-nums ${scanned ? 'text-lg text-mut' : 'text-6xl text-accent font-light'}`}>−{s.pct}%</span>
        <span className="text-micro uppercase tracking-wider text-dim tabular-nums">.deso {s.d} TOK vs .md {s.m} TOK → Δ {s.m - s.d} TOK {tr('tiSaved')}</span>
      </div>
      <table className="text-xs w-full max-w-2xl tabular-nums">
        <thead className="text-dim text-micro uppercase tracking-wider text-right"><tr className="border-b border-line2"><th className="py-1 font-medium text-left">{tr('tiConstruct')}</th><th className="font-medium">.deso</th><th className="font-medium">.md</th><th className="font-medium">{tr('savedCol')}</th><th className="w-32" /></tr></thead>
        <tbody>
          {Object.entries(kinds).map(([k, v]) => {
            const max = Math.max(v.d, v.m, 1)
            return (
              <tr key={k} className="border-b border-line text-right">
                <td className="py-1.5 text-mut text-left">{k}</td><td>{v.d}</td><td>{v.m}</td>
                <td className={v.m >= v.d ? 'text-fg' : 'text-status-err'}>{v.m - v.d}</td>
                <td className="pl-3">
                  <div className="h-[3px] bg-accent" title={`.deso ${v.d}`} style={{ width: `${(v.d / max) * 100}%` }} />
                  <div className="h-[3px] mt-0.5 bg-line2" title={`.md ${v.m}`} style={{ width: `${(v.m / max) * 100}%` }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-px bg-line border border-line flex-1 min-h-0 text-xs">
        {[['[SECTION A: NANOMARK .DESO]', note.content, 'text-fg'], ['[SECTION B: OBSIDIAN .MD]', md, 'text-mut']].map(([h, t, c]) => (
          <section key={h} className="bg-surface flex flex-col min-h-0 overflow-hidden">
            <header className="px-3 py-1.5 bg-panel border-b border-line text-micro tracking-wider text-mut">{h} <span className="text-dim">· {t.length} bytes</span></header>
            <pre className={`p-3 font-mono overflow-auto whitespace-pre-wrap ${c}`}>{t}</pre>
          </section>
        ))}
      </div>
      <p className="text-micro text-dim">{tr('tiEstimate')}</p>
    </div>
  )
}
