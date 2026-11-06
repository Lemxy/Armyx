/** Pill switch with a thumb that glides to the active option. Options share the width equally. */
export default function Segmented<T extends string>({ value, options, onChange, className = '' }: {
  value: T; options: readonly (readonly [T, React.ReactNode])[]; onChange: (v: T) => void; className?: string
}) {
  const i = Math.max(0, options.findIndex((o) => o[0] === value))
  return (
    <div role="tablist" className={`relative flex p-0.5 rounded-full bg-field border border-line ${className}`}>
      <span aria-hidden data-ease className="absolute top-0.5 bottom-0.5 left-0.5 rounded-full bg-panel border border-line2 shadow-float"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${i * 100}%)`, transition: 'transform .45s var(--ease)' }} />
      {options.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={id === value} onClick={() => onChange(id)}
          className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 px-3 py-1 text-xs rounded-full whitespace-nowrap ${id === value ? 'text-fg' : 'text-dim hover:text-mut'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}
