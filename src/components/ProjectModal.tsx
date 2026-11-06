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
      <ul className="flex flex-col gap-1.5">
        {projects.length === 0 && <li className="text-dim text-xs">{t('projEmpty')}</li>}
        {projects.map((id) => (
          <li key={id} className={`group flex items-center rounded-lg border ${id === active ? 'bg-panel border-line2' : 'bg-surface border-line hover:border-line2'}`}>
            <button onClick={() => go(id)} title={id} className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-left">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-panel border border-line shrink-0"><FolderOpen size={15} className={id === active ? 'text-fg' : 'text-dim'} /></span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{projectLabel(id)}</span>
                {inTauri && <span className="block truncate text-[11px] text-dim">{id}</span>}
              </span>
              {id === active && <Check size={15} className="ml-auto shrink-0 text-fg" />}
            </button>
            {id !== active && (
              <button onClick={() => remove(id)} title={inTauri ? `${t('projRemove')}. ${t('projFilesStay')}` : t('projRemoveWeb')}
                className="p-2 mr-1 rounded-lg text-dim opacity-0 group-hover:opacity-100 hover:text-rose-300 hover:bg-panel focus:opacity-100"><Trash2 size={14} /></button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 pt-3 border-t border-line">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">{t('projNew')} <span className="normal-case tracking-normal font-normal">· {inTauri ? t('projNewDesc') : t('projNewDescWeb')}</span></span>
        <form onSubmit={(e) => { e.preventDefault(); create() }} className="flex gap-2">
          <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr('') }} placeholder={t('projName')}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface border border-line focus:border-line2 outline-none text-xs placeholder:text-dim" />
          <button disabled={!name.trim()} className="flex items-center gap-1.5 px-3.5 rounded-lg bg-fg text-bg hover:bg-fg/90 text-xs font-semibold disabled:opacity-40">
            <FolderPlus size={13} />{t('create')}
          </button>
        </form>
        {inTauri && (
          <button onClick={open} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface border border-line hover:border-line2 text-left">
            <FolderOpen size={15} className="text-dim" />
            <span><span className="block text-xs font-medium">{t('projOpen')}</span><span className="block text-[11px] text-dim">{t('projOpenDesc')}</span></span>
          </button>
        )}
        {err && <p className="text-xs text-rose-300">{err}</p>}
      </div>
    </Modal>
  )
}
