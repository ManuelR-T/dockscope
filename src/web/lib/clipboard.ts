import { addToast } from '../stores/toast.svelte';

export async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    addToast(`Copied ${label}`, 'info');
  } catch {
    addToast('Failed to copy', 'error');
  }
}
