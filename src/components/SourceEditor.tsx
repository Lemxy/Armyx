import { useEffect, useRef, useState } from 'react'
import { FileCode } from 'lucide-react'
import { prop, type Note } from '../deso'
import { useI18n } from '../i18n'
import { readSource, saveSource } from '../vault'
import Editor from './Editor'
import Segmented from './Segmented'

type View = 'both' | 'file' | 'note'
const VIEW = 'deso_srcview'

/** The project file a scanned note stands for: it is opened for editing here, never launched. Saved on pause and on Ctrl+S. */
function SourceEditor({ path }: { path: string }) {
  const { t } = useI18n()
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const gutter = useRef<HTMLDivElement>(null)
  const latest = useRef({ text: '', dirty: false })
  const timer = useRef(0)

  const save = () => {
    clearTimeout(timer.current)
    if (!latest.current.dirty) return Promise.resolve()
    latest.current.dirty = false
    return saveSource(path, latest.current.text).then(() => setDirty(latest.current.dirty)).catch((e) => { latest.current.dirty = true; setErr(String(e)) })
  }
  useEffect(() => {
    readSource(path).then((c) => { latest.current = { text: c, dirty: false }; setText(c) }).catch((e) => setErr(String(e)))
    return () => { save().catch(console.error) } // leaving the note must not drop the last edit
  }, [path])

  const change = (v: string) => {
    latest.current = { text: v, dirty: true }
    setText(v); setDirty(true); setErr('')
    clearTimeout(timer.current); timer.current = window.setTimeout(() => { save().catch(console.error) }, 700)
  }
  // shortcut: plain text, no syntax colours; add a highlighter if this becomes the main editor.
  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="px-5 pt-6 pb-3 flex items-center gap-2 text-micro text-dim min-w-0">
        <FileCode size={13} className="shrink-0" /><span className="truncate" title={path}>{path}</span>
        <span className={`ml-auto shrink-0 ${err ? 'text-status-err' : ''}`}>{err ? '' : dirty ? t('srcSaving') : text !== null ? t('srcSaved') : ''}</span>
      </div>
      {err && <p className="px-5 pb-3 text-xs text-status-err whitespace-pre-wrap">{err}</p>}
      {text !== null && (
        <div className="flex flex-1 min-h-0 border-t border-line">
          <div ref={gutter} aria-hidden className="w-12 shrink-0 overflow-hidden pt-2 text-line2 text-micro font-mono select-none pr-2 text-right tabular-nums">
            {text.split('\n').map((_, i) => <div key={i} className="leading-6">{i + 1}</div>)}
          </div>
          <textarea value={text} wrap="off" spellCheck={false} onChange={(e) => change(e.target.value)}
            onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save().catch(console.error) }
              if (e.key === 'Tab') { e.preventDefault(); const el = e.currentTarget; el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end'); change(el.value) }
            }}
            className="flex-1 min-w-0 pt-2 pb-10 pl-3 pr-6 bg-transparent font-mono text-[13px] leading-6 whitespace-pre overflow-auto resize-none outline-none text-fg caret-accent" />
        </div>
      )}
    </div>
  )
}

/** Editor tab for a note made from a project file: the file itself on one side, what .deso generated for it on the other. */
export default function FileSplit({ note, notes, onChange }: { note: Note; notes: Note[]; onChange: (c: string) => void }) {
  const { t } = useI18n()
  const path = prop(note.content, 'path')!
  const [view, setView] = useState<View>(() => (['both', 'file', 'note'].includes(localStorage.getItem(VIEW) ?? '') ? localStorage.getItem(VIEW) as View : 'both'))
  const pick = (v: View) => { setView(v); localStorage.setItem(VIEW, v) }
  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-4 flex justify-end">
        <Segmented<View> value={view} onChange={pick} className="w-72" options={[['both', t('srcBoth')], ['file', t('srcFile')], ['note', t('srcNote')]]} />
      </div>
      <div className="flex flex-1 min-h-0">
        {view !== 'note' && <div className="flex-1 min-w-0"><SourceEditor key={path} path={path} /></div>}
        {view === 'both' && <div className="w-px shrink-0 bg-line" />}
        {view !== 'file' && <div className="flex-1 min-w-0"><Editor key={note.name} note={note} notes={notes} onChange={onChange} /></div>}
      </div>
    </div>
  )
}
