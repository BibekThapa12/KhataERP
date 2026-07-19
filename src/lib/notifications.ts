export type NotificationKind = 'success' | 'error' | 'info'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  description?: string
  duration?: number
}

export const APP_NOTIFICATION_EVENT = 'khataerp:notification'
const TOAST_DURATION_MS = 2000

function publishNotification(notification: Omit<AppNotification, 'id'>) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AppNotification>(APP_NOTIFICATION_EVENT, {
    detail: { id: crypto.randomUUID(), ...notification },
  }))
}

export function notifySuccess(title: string, description?: string) {
  publishNotification({ kind: 'success', title, description, duration: TOAST_DURATION_MS })
}

export function notifyError(title: string, description?: string) {
  publishNotification({ kind: 'error', title, description, duration: TOAST_DURATION_MS })
}

export function notifyInfo(title: string, description?: string) {
  publishNotification({ kind: 'info', title, description, duration: TOAST_DURATION_MS })
}
