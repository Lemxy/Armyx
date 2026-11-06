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
    <div onMouseDown={onClose} className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}
        className="anim-pop w-[26rem] max-w-[92%] max-h-[85%] overflow-auto rounded-lg bg-panel border border-line text-[13px]">
        <div className="flex items-center px-4 h-12 border-b border-line">
          <span className="font-semibold tracking-tight">{title}</span>
          <button onClick={onClose} title={t('close')} className="ml-auto p-1 rounded text-dim hover:text-fg hover:bg-line"><X size={15} /></button>
        </div>
        <div className="p-4 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  )
}
