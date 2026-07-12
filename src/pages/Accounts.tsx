import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import type { AccountType } from '@/types'

const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense']

function AddAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addAccount = useAppStore(s => s.addAccount)
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('Expense')
  const [group, setGroup] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!name.trim()) { setError('Enter account name.'); return }
    if (!group.trim()) { setError('Enter a group.'); return }
    setSaving(true)
    try {
      await addAccount({ name: name.trim(), type, group: group.trim() })
      onClose()
      setName(''); setType('Expense'); setGroup(''); setError('')
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New Account</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Account Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Office Supplies" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <SearchableSelect value={type} onValueChange={v => setType(v as AccountType)} options={ACCOUNT_TYPES.map(value => ({ value, label: value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Group</Label>
            <Input value={group} onChange={e => setGroup(e.target.value)} placeholder="e.g. Indirect Expenses" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AccountsPage() {
  const accounts = useAppStore(s => s.accounts)
  const [showForm, setShowForm] = useState(false)

  const grouped = ACCOUNT_TYPES.reduce((acc, type) => {
    acc[type] = accounts.filter(a => a.type === type && !a.is_party).sort((a, b) => a.name.localeCompare(b.name))
    return acc
  }, {} as Record<AccountType, typeof accounts>)

  return (
    <div>
      <PageHeader
        title="Chart of Accounts"
        description="All ledger accounts with current balances"
        action={<Button variant="outline" onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1.5" />New Account</Button>}
      />
      <PageContent className="space-y-4">
        {ACCOUNT_TYPES.map(type => {
          const list = grouped[type]
          if (!list || list.length === 0) return null
          return (
            <Card key={type}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{type}</CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-1">
                <table className="w-full text-sm border-collapse">
                  <tbody>
                    {list.map(a => (
                      <tr key={a.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-medium">{a.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">{a.group}</td>
                        <td className="px-4 py-2.5 text-right num font-semibold">{fmtMoney(a.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )
        })}
      </PageContent>
      <AddAccountDialog open={showForm} onClose={() => setShowForm(false)} />
    </div>
  )
}
