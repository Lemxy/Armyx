import { useState } from 'react'
import { useI18n, type Lang } from '../i18n'
import Modal from './Modal'
import Segmented from './Segmented'
import { getKey, setKey } from '../keys'

const label = 'text-micro text-dim'

const FIELDS = [['deepseek', 'dsKey', 'sk-…'], ['openrouter', 'orKey', 'sk-or-…'], ['nvidia', 'nvKey', 'nvapi-…'], ['agy', 'gemKey', 'AIza…'], ['claude', 'claudeKey', 'sk-ant-…']] as const
const input = 'px-3 py-2 rounded-lg bg-field border border-line focus:border-accent outline-none text-sm placeholder:text-dim'

function KeyField({ id, name, hint }: { id: string; name: string; hint: string }) {
  const { t } = useI18n()
  const [shown, setShown] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <span className={label}>{name}</span>
      <div className="flex gap-2">
        <input type={shown ? 'text' : 'password'} defaultValue={getKey(id)} onChange={(e) => setKey(id, e.target.value)} placeholder={hint} autoComplete="off" spellCheck={false} className={`${input} flex-1 min-w-0`} />
        <button type="button" onClick={() => setShown((v) => !v)} className="px-3 rounded-lg border border-line text-micro text-dim hover:text-fg">{shown ? t('hideKey') : t('showKey')}</button>
      </div>
    </div>
  )
}

export default function SettingsModal({ onClose, tab: first = 'general' }: { onClose: () => void; tab?: 'general' | 'api' }) {
  const { t, lang, setLang, smooth, setSmooth, hideOut, setHideOut } = useI18n()
  const [tab, setTab] = useState(first)
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'steel')
  const pick = (v: string) => { document.documentElement.dataset.theme = v; localStorage.setItem('deso_theme', v); setTheme(v) }
  return (
    <Modal title={t('settings')} onClose={onClose}>
      <Segmented value={tab} onChange={setTab} options={[['general', t('generalTab')], ['api', t('apiTab')]]} />
      {tab === 'api' ? <>
        {FIELDS.map(([id, n, hint]) => <KeyField key={id} id={id} name={t(n)} hint={hint} />)}
        <div className="flex flex-col gap-2">
          <span className={label}>{t('gwLabel')}</span>
          <input defaultValue={getKey('dsGateway')} onChange={(e) => setKey('dsGateway', e.target.value)} placeholder="https://your-gateway.com/v1" autoComplete="off" className={input} />
        </div>
      </> : <>
      <div className="flex flex-col gap-2">
        <span className={label}>{t('language')}</span>
        <Segmented<Lang> value={lang} onChange={setLang} options={[['en', 'English'], ['ru', 'Русский']]} />
      </div>
      <div className="flex flex-col gap-2">
        <span className={label}>{t('theme')}</span>
        <Segmented value={theme} onChange={pick} options={[['steel', t('steel')], ['dark', t('dark')], ['light', t('light')]]} />
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
      <button role="switch" aria-checked={hideOut} onClick={() => setHideOut(!hideOut)} className="flex items-center gap-4 text-left pt-1">
        <span className="flex-1">
          <span className="block text-sm">{t('hideOut')}</span>
          <span className="block text-micro text-dim mt-0.5">{t('hideOutDesc')}</span>
        </span>
        <span className={`relative w-10 h-6 rounded-full shrink-0 border ${hideOut ? 'border-accent bg-accent-dim' : 'border-line bg-field'}`}>
          <span data-ease className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full ${hideOut ? 'translate-x-4 bg-accent' : 'bg-dim'}`} />
        </span>
      </button>
      </>}
    </Modal>
  )
}
