import { useState } from 'react'
import { Check, FolderOpen, FolderPlus, Trash2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { badProjectName, inTauri, listProjects, newProjectId, pickFolder, projectLabel, removeProject } from '../vault'
import Modal from './Modal'

interface Props { active: string; onSwitch: (id: string) => Promise<void>; onClose: () => void }

export default function ProjectModal({ active, onSwitch, onClose }: Props) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [, refresh] = useState(0)
  const projects = listProjects()

  const go = async (id: string) => { try { await onSwitch(id) } catch (e) { setErr(String(e)) } }
  const create = async () => {
    if (badProjectName(name)) return setErr(t('projBadName'))
    await go(await newProjectId(name))
  }
  const open = async () => { const dir = await pickFolder().catch((e) => (setErr(String(e)), null)); if (dir) await go(dir) }
  const remove = (id: string) => {
    if (!inTauri && !confirm(t('deleteConfirm', { n: projectLabel(id) }))) return
    removeProject(id); refresh((n) => n + 1)
  }

  return (
    <Modal title={t('projTitle')} onClose={onClose}>
      <ul className="flex flex-col gap-1">
        {projects.length === 0 && <li className="text-dim text-xs">{t('projEmpty')}</li>}
        {projects.map((id) => (
          <li key={id} className={`group flex items-center rounded-xl border ${id === active ? 'bg-panel border-line2' : 'border-transparent hover:bg-panel'}`}>
            <button onClick={() => go(id)} title={id} className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-left">
              <FolderOpen size={13} className={`shrink-0 ${id === active ? 'text-accent' : 'text-dim'}`} />
              <span className="min-w-0">
                <span className="block truncate text-sm">{projectLabel(id)}</span>
                {inTauri && <span className="block truncate text-micro text-dim">{id}</span>}
              </span>
              {id === active && <Check size={13} className="ml-auto shrink-0 text-accent" />}
            </button>
            {id !== active && (
              <button onClick={() => remove(id)} title={inTauri ? `${t('projRemove')}. ${t('projFilesStay')}` : t('projRemoveWeb')}
                className="p-2 mr-1 rounded-lg text-dim opacity-0 group-hover:opacity-100 hover:text-status-err focus:opacity-100"><Trash2 size={14} /></button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2.5 pt-4 border-t border-line">
        <span className="text-micro text-dim">{t('projNew')} <span>· {inTauri ? t('projNewDesc') : t('projNewDescWeb')}</span></span>
        <form onSubmit={(e) => { e.preventDefault(); create() }} className="flex gap-2">
          <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr('') }} placeholder={t('projName')}
            className="flex-1 min-w-0 px-3.5 py-2 rounded-xl bg-field border border-line focus:border-accent outline-none text-sm placeholder:text-dim" />
          <button disabled={!name.trim()} className="btn-press flex items-center gap-1.5 px-4 rounded-xl bg-accent text-bg font-medium text-xs hover:opacity-90 disabled:opacity-30">
            <FolderPlus size={13} />{t('create')}
          </button>
        </form>
        {inTauri && (
          <button onClick={open} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-line hover:bg-panel text-left">
            <FolderOpen size={15} className="text-dim" />
            <span><span className="block text-sm">{t('projOpen')}</span><span className="block text-micro text-dim">{t('projOpenDesc')}</span></span>
          </button>
        )}
        {err && <p className="text-xs text-status-err">{err}</p>}
      </div>
    </Modal>
  )
}
