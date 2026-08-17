import { useEffect, useState } from 'react'
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
        <DialogTitle>Unsaved changes</DialogTitle>
      </DialogHeader>
      <p className="text-sm leading-6 text-muted-foreground">{UNSAVED_CHANGES_MESSAGE}</p>
      <DialogFooter>
        <Button variant="outline" data-dialog-autofocus onClick={() => resolveUnsavedChangesConfirmation(false)}>Keep Editing</Button>
        <Button variant="destructive" onClick={() => resolveUnsavedChangesConfirmation(true)}>Discard &amp; Leave</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
