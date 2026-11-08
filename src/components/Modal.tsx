import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../i18n'

export default function Modal({ title, onClose: done, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useI18n()
  const [out, setOut] = useState(false)
  // play the exit animation, then really close (timer, not animationend, so it also works with motion off)
  const onClose = () => { if (!out) { setOut(true); setTimeout(done, 180) } }
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  return (
    <div onMouseDown={onClose} className={`${out ? 'anim-fade-out' : 'anim-fade'} fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm`}>
      <div onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}
        className={`${out ? 'anim-pop-out' : 'anim-pop'} w-[28rem] max-w-[92%] max-h-[85%] overflow-auto rounded-2xl bg-surface border border-line shadow-float text-sm`}>
        <div className="flex items-center px-6 pt-5 pb-1">
          <span className="font-serif text-title font-semibold">{title}</span>
          <button onClick={onClose} title={t('close')} className="ml-auto p-1.5 rounded-lg text-dim hover:text-fg hover:bg-panel"><X size={16} /></button>
        </div>
        <div className="px-6 pt-3 pb-6 flex flex-col gap-5">{children}</div>
      </div>
    </div>
  )
}
