import { createPortal } from 'react-dom'
import { useToasts } from '../toasts'

export function ToastContainer() {
  const toasts = useToasts((s) => s.toasts)

  if (toasts.length === 0) return null

  return createPortal(
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      ))}
    </div>,
    document.body,
  )
}
