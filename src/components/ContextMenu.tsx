import { useEffect } from 'react'

export interface MenuItem { label: string; onClick: () => void; danger?: boolean }
export interface MenuState { x: number; y: number; items: MenuItem[] }

export default function ContextMenu({ x, y, items, onClose }: MenuState & { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', onClose)
    window.addEventListener('keydown', k)
    window.addEventListener('blur', onClose)
    return () => { window.removeEventListener('mousedown', onClose); window.removeEventListener('keydown', k); window.removeEventListener('blur', onClose) }
  }, [onClose])
  return (
    <ul onMouseDown={(e) => e.stopPropagation()} role="menu"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - items.length * 32 - 16) }}
      className="fixed z-50 w-52 py-1 rounded-lg bg-[#18181b] border border-[#27272a] text-[13px]">
      {items.map((i) => (
        <li key={i.label}>
          <button role="menuitem" onClick={() => { onClose(); i.onClick() }}
            className={`w-full text-left px-3 py-1.5 hover:bg-[#27272a] ${i.danger ? 'text-rose-300' : 'text-mut hover:text-fg'}`}>{i.label}</button>
        </li>
      ))}
    </ul>
  )
}
