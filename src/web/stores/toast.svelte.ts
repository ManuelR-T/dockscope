interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toasts = $state<Toast[]>([]);
let toastId = 0;

export function addToast(message: string, type: Toast['type'] = 'info') {
  const id = ++toastId;
  toasts = [...toasts, { id, message, type }];
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
  }, 4000);
}

export function getToasts() {
  return {
    get list() {
      return toasts;
    },
  };
}
