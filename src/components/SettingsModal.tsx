import { useI18n, type Lang } from '../i18n'
import Modal from './Modal'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t, lang, setLang, smooth, setSmooth } = useI18n()
  return (
    <Modal title={t('settings')} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <span className="text-mut text-xs">{t('language')}</span>
        <div className="flex gap-1 p-1 rounded-md bg-surface border border-line">
          {([['en', 'English'], ['ru', 'Русский']] as [Lang, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setLang(id)}
              className={`flex-1 py-1 rounded text-xs font-medium ${lang === id ? 'bg-line text-fg' : 'text-dim hover:text-fg'}`}>{label}</button>
          ))}
        </div>
      </div>
      <button role="switch" aria-checked={smooth} onClick={() => setSmooth(!smooth)} className="flex items-center gap-3 text-left">
        <span className="flex-1">
          <span className="block">{t('smooth')}</span>
          <span className="block text-xs text-dim">{t('smoothDesc')}</span>
        </span>
        <span className={`relative w-9 h-5 rounded-full shrink-0 border border-line ${smooth ? 'bg-fg' : 'bg-surface'}`}>
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full ${smooth ? 'translate-x-4 bg-bg' : 'bg-dim'}`} />
        </span>
      </button>
    </Modal>
  )
}
