import { lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Printer, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
import { categoryPath } from '@/lib/categoryHierarchy'
import { fmtMoney } from '@/lib/utils'
import { publicErrorMessage, safeErrorMessage } from '@/lib/security'
import { SubmissionLock } from '@/lib/submissionLock'
import type { SimpleEntryLineInput } from '@/lib/simpleEntries'
import { buildSimpleEntryLines, simpleEntryCounterAccounts } from '@/lib/simpleEntries'
import type { SimpleEntryType, Voucher } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { focusLastSearchableSelect } from '@/lib/searchableSelectFocus'
import { VoucherNumberField } from '@/components/forms/VoucherNumberField'
import { stableFormSnapshot, useUnsavedChangesGuard } from '@/lib/unsavedChanges'
import { beginVoucherPrint, cancelVoucherPrint, completeVoucherPrint, useVoucherShortcuts, type VoucherPrintRequest } from '@/lib/voucherShortcuts'

const LedgerDialog = lazy(() => import('@/pages/Masters').then(module => ({ default: module.LedgerDialog })))

type DraftPayload = {
  simpleEntryType?: SimpleEntryType
  counterAccountId?: string
  lines?: SimpleEntryLineInput[]
  narration?: string
  dateBs?: string
  journalInvoiceNo?: string
}

const blankLine = (): SimpleEntryLineInput => ({ category_id: '', account_id: '', amount: 0 })

function simpleEntryError(error: unknown, entryType: SimpleEntryType) {
  const message = safeErrorMessage(error)
  if (/simple_entry_type.*(does not exist|schema cache)|could not find.*simple_entry_type/i.test(message)) return 'Income and Expense entries are not enabled in the database yet. Apply the Simple Income/Expense migration, then reload the app.'
  if (/simple entry ledger lines are invalid|simple entry requires|counter ledger is unavailable/i.test(message)) return `This ${entryType.toLowerCase()} could not be posted because one of the selected ledgers is unavailable or no longer valid. Reload the page and select the ledgers again.`
  if (/^(select|add|enter|the receiving|the paying|line \d+|complete financial year|voucher date|cannot save voucher)/i.test(message)) return message
  return publicErrorMessage(error, `saving ${entryType.toLowerCase()}`)
}

export function SimpleEntryForm({ entryType, open, voucher, onClose }: { entryType: SimpleEntryType; open: boolean; voucher?: Voucher | null; onClose: () => void }) {
  const { company, rawAccounts, accountCategories, parties, saveSimpleEntry, updateSimpleEntry, saveDraftVoucher, deleteDraftVoucher } = useAppStore()
  const manualNumbering = company?.journal_numbering_mode === 'manual'
  const [dateBs, setDateBs] = useState(() => selectedFiscalYearEndBs(company))
  const [invoiceNo, setInvoiceNo] = useState('')
  const [counterAccountId, setCounterAccountId] = useState('')
  const [lines, setLines] = useState<SimpleEntryLineInput[]>([blankLine()])
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ledgerLineIndex, setLedgerLineIndex] = useState<number | null>(null)
  const submissionLock = useRef(new SubmissionLock()).current
  const initializedFormRef = useRef<string | null>(null)
  const baselineRef = useRef('')
  const snapshotRef = useRef('')
  const workingDraftIdRef = useRef<string | undefined>(voucher?.status === 'Draft' ? voucher.id : undefined)
  const freshAfterDraftRef = useRef(false)
  const pendingLineFocus = useRef(false)

  const activeAccounts = useMemo(() => rawAccounts.filter(account => !account.is_archived).sort((a, b) => a.name.localeCompare(b.name)), [rawAccounts])
  const counterChoices = useMemo(() => company ? simpleEntryCounterAccounts(rawAccounts, accountCategories, parties, company.id) : { cashAndBanks: [], partyAccounts: [], partyByAccount: new Map() }, [company, rawAccounts, accountCategories, parties])
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)

  useEffect(() => {
    const formIdentity = `${entryType}:${voucher?.id || 'new'}`
    if (!open) { initializedFormRef.current = null; baselineRef.current = ''; workingDraftIdRef.current = undefined; freshAfterDraftRef.current = false; return }
    if (initializedFormRef.current === formIdentity) return
    initializedFormRef.current = formIdentity
    baselineRef.current = ''
    workingDraftIdRef.current = voucher?.status === 'Draft' ? voucher.id : undefined
    freshAfterDraftRef.current = false
    const draft = (voucher?.draft_payload || {}) as DraftPayload
    const storedLines = draft.lines?.length
      ? draft.lines
      : (voucher?.lines || []).filter(line => line.account_id !== voucher?.settlement_account_id).map(line => ({
          category_id: rawAccounts.find(account => account.id === line.account_id)?.category_id || '',
          account_id: line.account_id,
          amount: entryType === 'Income' ? line.credit : line.debit,
        })).filter(line => line.amount > 0)
    setDateBs(draft.dateBs || voucher?.date_bs || selectedFiscalYearEndBs(company))
    setInvoiceNo(draft.journalInvoiceNo ?? voucher?.invoice_no ?? '')
    setCounterAccountId(draft.counterAccountId || voucher?.settlement_account_id || '')
    setLines(storedLines.length ? storedLines : [blankLine()])
    setNarration(draft.narration ?? voucher?.narration ?? '')
    setError('')
    window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
  }, [open, voucher, entryType, rawAccounts, company])

  const formSnapshot = stableFormSnapshot({ dateBs, invoiceNo, counterAccountId, lines, narration })
  snapshotRef.current = formSnapshot
  const dirty = open && baselineRef.current !== '' && formSnapshot !== baselineRef.current
  const confirmDiscard = useUnsavedChangesGuard(open, dirty)

  const updateLine = (index: number, updates: Partial<SimpleEntryLineInput>) => setLines(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...updates } : line))
  useEffect(() => {
    if (!pendingLineFocus.current) return
    pendingLineFocus.current = false
    const frame = window.requestAnimationFrame(() => focusLastSearchableSelect(`Select ${entryType.toLowerCase()} ledger`))
    return () => window.cancelAnimationFrame(frame)
  }, [lines.length, entryType])
  const params = () => ({ entry_type: entryType, counter_account_id: counterAccountId, lines, narration: narration.trim(), date_bs: dateBs, invoice_no: manualNumbering ? invoiceNo.trim() : undefined })

  const complete = async (shouldPrint = false) => {
    if (manualNumbering && !invoiceNo.trim()) return setError('Enter the Journal voucher number.')
    if (!counterAccountId) return setError(entryType === 'Income' ? 'Select where the income was received: Cash, Bank, Customer, or Supplier.' : 'Select where the expense was paid from: Cash, Bank, Customer, or Supplier.')
    const allowedCounterIds = new Set([...counterChoices.cashAndBanks, ...counterChoices.partyAccounts].map(account => account.id))
    if (!allowedCounterIds.has(counterAccountId)) return setError('The selected Cash, Bank, Customer, or Supplier ledger is no longer available. Select another ledger.')
    try { buildSimpleEntryLines(params(), rawAccounts, accountCategories) }
    catch (validationError) { return setError(simpleEntryError(validationError, entryType)) }
    if (!submissionLock.tryAcquire()) return
    let printRequest: VoucherPrintRequest | undefined = shouldPrint ? beginVoucherPrint() : undefined
    setSaving(true); setError('')
    try {
      const targetVoucherId = freshAfterDraftRef.current ? undefined : (voucher?.id || workingDraftIdRef.current)
      if (targetVoucherId) await updateSimpleEntry(targetVoucherId, params(), 'Completed')
      else await saveSimpleEntry(params(), 'Completed')
      workingDraftIdRef.current = undefined
      completeVoucherPrint(printRequest, 'Journal', voucher)
      printRequest = undefined
      onClose()
    } catch (caught) { cancelVoucherPrint(printRequest); setError(simpleEntryError(caught, entryType)) }
    finally { submissionLock.release(); setSaving(false) }
  }

  useVoucherShortcuts({ open, disabled: saving, draftDisabled: saving, onSave: () => { void complete() }, onSaveAndPrint: () => { void complete(true) }, onSaveDraft: !voucher || voucher.status === 'Draft' ? () => { void saveDraft() } : undefined })

  const saveDraft = async () => {
    if (voucher && voucher.status !== 'Draft') return setError('Completed entries cannot be saved as draft.')
    setSaving(true); setError('')
    try {
      await saveDraftVoucher({
        id: freshAfterDraftRef.current ? undefined : (workingDraftIdRef.current || (voucher?.status === 'Draft' ? voucher.id : undefined)),
        type: 'Journal', date_bs: dateBs, narration, total,
        settlement_account_id: counterAccountId || null, simple_entry_type: entryType,
        draft_payload: { simpleEntryType: entryType, counterAccountId, lines, narration, dateBs, journalInvoiceNo: invoiceNo },
      })
      workingDraftIdRef.current = undefined; freshAfterDraftRef.current = true; baselineRef.current = ''
      setDateBs(selectedFiscalYearEndBs(company)); setInvoiceNo(''); setCounterAccountId(''); setLines([blankLine()]); setNarration(''); setError('')
      window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
    } catch (caught) { setError(publicErrorMessage(caught, `saving ${entryType.toLowerCase()} draft`)) }
    finally { setSaving(false) }
  }

  const removeDraft = async () => {
    if (!voucher || voucher.status !== 'Draft') return
    setSaving(true)
    try { await deleteDraftVoucher(voucher.id); onClose() }
    catch (caught) { setError(publicErrorMessage(caught, 'deleting draft')) }
    finally { setSaving(false) }
  }

  return <>
    <Dialog open={open} onOpenChange={next => { if (!next) void confirmDiscard().then(confirmed => { if (confirmed) onClose() }) }}>
      <DialogContent className="voucher-dialog max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{voucher ? 'Edit' : 'Add'} {entryType}</DialogTitle></DialogHeader>
        <p className="-mt-2 text-sm text-muted-foreground">No debit or credit knowledge needed. Choose where the money moved and what it was for.</p>
        <div className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Date</Label><NepaliDateInput value={dateBs} onChange={setDateBs} min={selectedFiscalYearStartBs(company)} max={selectedFiscalYearEndBs(company)} /></div>
            {manualNumbering ? <div className="space-y-1.5"><Label>Voucher Number</Label><Input value={invoiceNo} maxLength={100} onChange={event => setInvoiceNo(event.target.value)} /></div> : <VoucherNumberField type="Journal" dateBs={dateBs} voucher={voucher} />}
          </div>
          <div className="space-y-1.5">
            <Label>{entryType === 'Income' ? 'Received into' : 'Paid from'} <span className="text-destructive">*</span></Label>
            <SearchableSelect value={counterAccountId} onValueChange={setCounterAccountId} placeholder="Select Cash, Bank, Customer, or Supplier" options={[
              ...counterChoices.cashAndBanks.map(account => ({ value: account.id, label: account.name, group: 'Cash & Bank', searchText: `${account.name} ${categoryPath(accountCategories, account.category_id)} ${account.group}` })),
              ...counterChoices.partyAccounts.map(account => { const party = counterChoices.partyByAccount.get(account.id); return { value: account.id, label: party?.name || account.name, group: party?.type === 'customer' ? 'Customers' : 'Suppliers', searchText: `${party?.name || account.name} ${party?.phone || ''} ${party?.pan_vat || ''} ${party?.address || ''}` } }),
            ]} />
          </div>
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_.35fr_auto] gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid"><span>{entryType} ledger</span><span>Amount</span><span /></div>
            {lines.map((line, index) => {
              const ledgers = activeAccounts.filter(account => account.type === entryType && account.category_id)
              return <div key={index} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_.35fr_auto] sm:border-0 sm:p-0">
                <div className="flex min-w-0 gap-1"><SearchableSelect className="min-w-0 flex-1" value={line.account_id} onValueChange={value => { const account = activeAccounts.find(item => item.id === value); updateLine(index, { account_id: value, category_id: account?.category_id || '' }) }} placeholder={`Select ${entryType.toLowerCase()} ledger`} options={ledgers.map(account => ({ value: account.id, label: account.name, group: categoryPath(accountCategories, account.category_id) || account.group, searchText: `${account.name} ${categoryPath(accountCategories, account.category_id)} ${account.group}` }))} /><Button type="button" variant="outline" size="icon" title={`Create ${entryType.toLowerCase()} ledger`} onClick={() => setLedgerLineIndex(index)}><Plus className="h-4 w-4" /></Button></div>
                <Input type="number" min="0" step="0.01" value={line.amount || ''} onChange={event => updateLine(index, { amount: Number(event.target.value) })} className="text-right" placeholder="0.00" />
                <Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines(current => { pendingLineFocus.current = true; return [...current, blankLine()] })}><Plus className="mr-1 h-4 w-4" />Add line</Button>
          </div>
          <div className="flex justify-between rounded-lg bg-muted/40 p-3 text-sm font-semibold"><span>Total</span><span className="num">{fmtMoney(total)}</span></div>
          <div className="space-y-1.5"><Label>Note</Label><Textarea value={narration} onChange={event => setNarration(event.target.value)} rows={2} placeholder={`What was this ${entryType.toLowerCase()} for?`} /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          {voucher?.status === 'Draft' && <Button variant="destructive" disabled={saving} onClick={removeDraft}>Delete Draft</Button>}
          <Button variant="outline" onClick={() => void confirmDiscard().then(confirmed => { if (confirmed) onClose() })}>Cancel</Button>
          {(!voucher || voucher.status === 'Draft') && <Button variant="outline" disabled={saving} onClick={saveDraft}>{voucher ? 'Update Draft' : 'Save as Draft'}<kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+D</kbd></Button>}
          <Button disabled={saving} onClick={() => complete()} title="Save voucher (Alt+S)">{saving ? 'Saving...' : voucher && voucher.status !== 'Draft' ? 'Save Changes' : `Complete ${entryType}`}{!saving && <kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+S</kbd>}</Button>
          <Button variant="outline" disabled={saving} onClick={() => complete(true)} title="Save and print (Alt+P)"><Printer className="mr-1 h-4 w-4" />Save &amp; Print<kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+P</kbd></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {ledgerLineIndex !== null && <LedgerDialog open allowedAccountType={entryType} defaultCategoryId={lines[ledgerLineIndex]?.category_id} onClose={() => setLedgerLineIndex(null)} onCreated={account => { updateLine(ledgerLineIndex, { account_id: account.id, category_id: account.category_id || '' }); setLedgerLineIndex(null) }} />}
  </>
}
