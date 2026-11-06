import { useState } from 'react'
import { useI18n, type Lang } from '../i18n'
import Modal from './Modal'
import Segmented from './Segmented'

const label = 'text-micro text-dim'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t, lang, setLang, smooth, setSmooth } = useI18n()
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const pick = (v: string) => { document.documentElement.dataset.theme = v; localStorage.setItem('deso_theme', v); setTheme(v) }
  return (
    <Modal title={t('settings')} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <span className={label}>{t('language')}</span>
        <Segmented<Lang> value={lang} onChange={setLang} options={[['en', 'English'], ['ru', 'Русский']]} />
      </div>
      <div className="flex flex-col gap-2">
        <span className={label}>{t('theme')}</span>
        <Segmented value={theme} onChange={pick} options={[['dark', t('dark')], ['light', t('light')]]} />
      </div>
      <button role="switch" aria-checked={smooth} onClick={() => setSmooth(!smooth)} className="flex items-center gap-4 text-left pt-1">
        <span className="flex-1">
          <span className="block text-sm">{t('smooth')}</span>
          <span className="block text-micro text-dim mt-0.5">{t('smoothDesc')}</span>
        </span>
        <span className={`relative w-10 h-6 rounded-full shrink-0 border ${smooth ? 'border-accent bg-accent-dim' : 'border-line bg-field'}`}>
          <span data-ease className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full ${smooth ? 'translate-x-4 bg-accent' : 'bg-dim'}`} />
        </span>
      </button>
    </Modal>
  )
}
