import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem { label: string; onClick: () => void; danger?: boolean; sep?: boolean }
export interface MenuState { x: number; y: number; items: MenuItem[] }

export default function ContextMenu({ x, y, items, onClose }: MenuState & { onClose: () => void }) {
  const ref = useRef<HTMLUListElement>(null)
  const [at, setAt] = useState({ left: x, top: y })
  // keep the whole menu on screen, measured after render
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    setAt({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) })
  }, [x, y, items])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', onClose)
    window.addEventListener('keydown', k)
    window.addEventListener('blur', onClose)
    return () => { window.removeEventListener('mousedown', onClose); window.removeEventListener('keydown', k); window.removeEventListener('blur', onClose) }
  }, [onClose])
  return (
    <ul ref={ref} onMouseDown={(e) => e.stopPropagation()} role="menu"
      style={at}
      className="fixed z-50 w-64 py-1 rounded-[2px] bg-panel border border-line2 font-mono text-xs">
      {items.map((i) => (
        <li key={i.label} className={i.sep ? "mt-1 pt-1 border-t border-line" : ""}>
          <button role="menuitem" onClick={() => { onClose(); i.onClick() }}
            className={`w-full text-left px-3 py-1.5 border-l-2 border-transparent hover:border-accent hover:bg-field ${i.danger ? 'text-status-err' : 'text-mut hover:text-fg'}`}>{i.label}</button>
        </li>
      ))}
    </ul>
  )
}
