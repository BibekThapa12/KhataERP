import { useEffect, useState } from 'react'
import * as Toast from '@radix-ui/react-toast'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { APP_NOTIFICATION_EVENT, type AppNotification } from '@/lib/notifications'
import { cn } from '@/lib/utils'

const notificationStyle = {
  success: 'border-emerald-200 bg-white text-emerald-950',
  error: 'border-red-200 bg-white text-red-950',
  info: 'border-blue-200 bg-white text-blue-950',
} as const

const notificationIcon = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const

export function AppToaster() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  useEffect(() => {
    const receiveNotification = (event: Event) => {
      const detail = (event as CustomEvent<AppNotification>).detail
      if (!detail) return
      setNotifications(current => [...current.slice(-3), detail])
    }
    window.addEventListener(APP_NOTIFICATION_EVENT, receiveNotification)
    return () => window.removeEventListener(APP_NOTIFICATION_EVENT, receiveNotification)
  }, [])

  const dismiss = (id: string) => {
    setNotifications(current => current.filter(notification => notification.id !== id))
  }

  return (
    <Toast.Provider swipeDirection="right">
      {notifications.map(notification => {
        const Icon = notificationIcon[notification.kind]
        return (
          <Toast.Root
            key={notification.id}
            defaultOpen
            duration={notification.duration}
            onOpenChange={open => { if (!open) dismiss(notification.id) }}
            className={cn(
              'app-toast grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-md border p-3 shadow-lg',
              notificationStyle[notification.kind],
            )}
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <Toast.Title className="text-sm font-semibold leading-5">{notification.title}</Toast.Title>
              {notification.description && (
                <Toast.Description className="mt-0.5 text-xs leading-4 opacity-80">
                  {notification.description}
                </Toast.Description>
              )}
            </div>
            <Toast.Close
              aria-label="Dismiss notification"
              className="rounded p-0.5 opacity-60 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </Toast.Close>
          </Toast.Root>
        )
      })}
      <Toast.Viewport className="fixed bottom-0 right-0 z-[200] flex max-h-screen w-full flex-col gap-2 p-4 outline-none sm:max-w-sm" />
    </Toast.Provider>
  )
}
