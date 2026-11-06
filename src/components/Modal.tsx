import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../i18n'

export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useI18n()
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div onMouseDown={onClose} className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-bg/80">
      <div onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}
        className="anim-pop w-[26rem] max-w-[92%] max-h-[85%] overflow-auto rounded-[2px] bg-panel border border-line text-xs">
        <div className="flex items-center px-3 h-9 border-b border-line bg-surface">
          <span className="font-mono text-micro uppercase tracking-widest text-mut">{title}</span>
          <button onClick={onClose} title={t('close')} className="ml-auto p-1 rounded-[2px] text-dim hover:text-fg"><X size={13} /></button>
        </div>
        <div className="px-4 pt-3.5 pb-4 flex flex-col gap-3.5">{children}</div>
      </div>
    </div>
  )
}
