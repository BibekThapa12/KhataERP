import { useEffect, useState } from 'react'
import {
  UNSAVED_CHANGES_MESSAGE,
  resolveUnsavedChangesConfirmation,
  subscribeUnsavedChangesConfirmation,
} from '@/lib/unsavedChanges'
import { TriangleAlert } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function UnsavedChangesDialogHost() {
  const [open, setOpen] = useState(false)
  useEffect(() => subscribeUnsavedChangesConfirmation(setOpen), [])

  return <AlertDialog open={open} onOpenChange={next => { if (!next) resolveUnsavedChangesConfirmation(false) }}>
    <AlertDialogContent className="unsaved-changes-dialog gap-0 overflow-hidden border-border/80 bg-background p-0 shadow-[0_18px_50px_-18px_rgba(15,29,55,0.42)] sm:max-w-[28rem] sm:p-0">
      <div className="flex items-start gap-3.5 px-5 pb-5 pt-5 sm:px-6 sm:pt-6">
        <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-destructive" strokeWidth={1.8} />
        <AlertDialogHeader className="min-w-0 space-y-2 text-left">
          <AlertDialogTitle className="text-[19px] leading-6 tracking-[-0.01em]">Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription className="max-w-[38ch] text-sm leading-5 text-muted-foreground">
            {UNSAVED_CHANGES_MESSAGE}
          </AlertDialogDescription>
        </AlertDialogHeader>
      </div>
      <AlertDialogFooter className="gap-2 border-t border-border/70 bg-muted/30 px-5 py-4 sm:px-6">
        <AlertDialogCancel className="mt-0 min-w-32 bg-background" onClick={() => resolveUnsavedChangesConfirmation(false)}>
          Continue Editing
        </AlertDialogCancel>
        <AlertDialogAction
          className="min-w-32 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={() => resolveUnsavedChangesConfirmation(true)}
        >
          Discard Changes
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
