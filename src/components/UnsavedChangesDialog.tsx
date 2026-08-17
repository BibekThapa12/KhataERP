import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  UNSAVED_CHANGES_MESSAGE,
  resolveUnsavedChangesConfirmation,
  subscribeUnsavedChangesConfirmation,
} from '@/lib/unsavedChanges'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function UnsavedChangesDialogHost() {
  const [open, setOpen] = useState(false)
  useEffect(() => subscribeUnsavedChangesConfirmation(setOpen), [])

  return <Dialog open={open} onOpenChange={next => { if (!next) resolveUnsavedChangesConfirmation(false) }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700"><AlertTriangle className="h-4 w-4" /></span>
          Unsaved changes
        </DialogTitle>
      </DialogHeader>
      <p className="text-sm leading-6 text-muted-foreground">{UNSAVED_CHANGES_MESSAGE}</p>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Leaving now will discard the changes made in this form.</p>
      <DialogFooter>
        <Button variant="outline" data-dialog-autofocus onClick={() => resolveUnsavedChangesConfirmation(false)}>Keep Editing</Button>
        <Button variant="destructive" onClick={() => resolveUnsavedChangesConfirmation(true)}>Discard &amp; Leave</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
