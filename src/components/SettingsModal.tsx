import { useState } from 'react'
import { useI18n, type Lang } from '../i18n'
import Modal from './Modal'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t, lang, setLang, smooth, setSmooth } = useI18n()
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const pick = (v: string) => { document.documentElement.dataset.theme = v; localStorage.setItem('deso_theme', v); setTheme(v) }
  return (
    <Modal title={t('settings')} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <span className="text-micro uppercase tracking-wider text-dim font-mono">{t('language')}</span>
        <div className="flex border border-line bg-field rounded-[2px]">
          {([['en', 'English'], ['ru', 'Русский']] as [Lang, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setLang(id)}
              className={`flex-1 py-1 text-xs border-b-2 ${lang === id ? 'border-accent text-fg bg-panel' : 'border-transparent text-dim hover:text-mut'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-micro uppercase tracking-wider text-dim font-mono">Theme</span>
        <div className="flex border border-line bg-field rounded-[2px]">
          {[['dark', 'Dark'], ['light', 'Light']].map(([id, label]) => (
            <button key={id} onClick={() => pick(id)}
              className={`flex-1 py-1 text-xs border-b-2 ${theme === id ? 'border-accent text-fg bg-panel' : 'border-transparent text-dim hover:text-mut'}`}>{label}</button>
          ))}
        </div>
      </div>
      <button role="switch" aria-checked={smooth} onClick={() => setSmooth(!smooth)} className="flex items-center gap-3 text-left">
        <span className="flex-1">
          <span className="block">{t('smooth')}</span>
          <span className="block text-micro text-dim">{t('smoothDesc')}</span>
        </span>
        <span className={`relative w-9 h-5 rounded-full shrink-0 border ${smooth ? 'border-accent bg-accent-dim' : 'border-line bg-field'}`}>
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full ${smooth ? 'translate-x-4 bg-accent' : 'bg-dim'}`} />
        </span>
      </button>
    </Modal>
  )
}
