import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

export interface ContextMenuItem {
  label: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * Fixed-position right-click menu. Closes on outside click, Esc, resize or
 * scroll; repositions itself to stay inside the viewport.
 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x, y })

  // Clamp the menu into the viewport once its size is known.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nx = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
    const ny = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
    setPos({ x: nx, y: ny })
  }, [x, y])

  useEffect(() => {
    function onPointerDown(e: MouseEvent): void {
      if (ref.current != null && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  return (
    <div className="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`context-menu-item${item.danger ? ' danger' : ''}`}
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Per-panel right-click state: `open(e, target)` on a row's onContextMenu,
 * then render `<ContextMenu …>` while `menu` is non-null.
 */
export function useContextMenu<T>() {
  const [menu, setMenu] = useState<{ x: number; y: number; target: T } | null>(null)

  function open(e: ReactMouseEvent, target: T): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, target })
  }

  function close(): void {
    setMenu(null)
  }

  return { menu, open, close }
}
