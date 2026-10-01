import { cn } from '@/lib/utils'

export function CreateShortcutHint({ className }: { className?: string }) {
  return <kbd aria-label="Keyboard shortcut Alt+N" className={cn('ml-2 rounded border border-current/25 px-1 py-0.5 font-mono text-[9px] font-semibold leading-none opacity-80', className)}>Alt+N</kbd>
}

export function ItemCreateShortcutHint({ className }: { className?: string }) {
  return <kbd aria-label="Keyboard shortcut Alt+I" className={cn('ml-2 rounded border border-current/25 px-1 py-0.5 font-mono text-[9px] font-semibold leading-none opacity-80', className)}>Alt+I</kbd>
}
