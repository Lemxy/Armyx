import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface Swatch { color: string; name: string; on: boolean; onClick: () => void }
export interface MenuItem { label: string; onClick?: () => void; danger?: boolean; sep?: boolean; swatches?: Swatch[] }
export interface MenuState { x: number; y: number; items: MenuItem[] }

export default function ContextMenu({ x, y, items, onClose }: MenuState & { onClose: () => void }) {
  const ref = useRef<HTMLUListElement>(null)
  const [at, setAt] = useState({ left: x, top: y, origin: 'top left' })
  // keep the whole menu on screen, measured after render; grow from the corner nearest the cursor
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    const flipX = x + r.width > window.innerWidth - 8, flipY = y + r.height > window.innerHeight - 8
    setAt({
      left: Math.max(8, flipX ? x - r.width : x), top: Math.max(8, flipY ? Math.min(y - r.height, window.innerHeight - r.height - 8) : y),
      origin: `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`,
    })
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
      style={{ left: at.left, top: at.top, ['--origin' as string]: at.origin }}
      className="anim-menu fixed z-50 w-64 p-1.5 rounded-xl bg-panel border border-line shadow-float text-sm">
      {items.map((i) => (
        <li key={i.label} className={i.sep ? 'mt-1.5 pt-1.5 border-t border-line' : ''}>
          {i.swatches ? (
            <div className="px-2.5 py-2 flex flex-col gap-2">
              <span className="text-micro text-dim">{i.label}</span>
              <div className="flex items-center gap-2">
                {i.swatches.map((s) => (
                  <button key={s.color} role="menuitemradio" aria-checked={s.on} title={s.name} aria-label={s.name} onClick={() => { onClose(); s.onClick() }}
                    style={{ background: `var(${s.color})`, boxShadow: s.on ? `0 0 0 2px var(--panel), 0 0 0 3.5px var(${s.color})` : undefined }}
                    className="w-5 h-5 rounded-full hover:scale-110 btn-press" />
                ))}
              </div>
            </div>
          ) : (
            <button role="menuitem" onClick={() => { onClose(); i.onClick?.() }}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-field ${i.danger ? 'text-status-err' : 'text-mut hover:text-fg'}`}>{i.label}</button>
          )}
        </li>
      ))}
    </ul>
  )
}
