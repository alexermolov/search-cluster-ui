import { create } from "zustand";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

interface ToastStore {
  toasts: Toast[];
  addToast(message: string, type?: "success" | "error"): void;
  removeToast(id: string): void;
}

let toastId = 0;

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type = "success") => {
    const id = `toast-${++toastId}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

export const addToast = (message: string, type?: "success" | "error") =>
  useToasts.getState().addToast(message, type);
