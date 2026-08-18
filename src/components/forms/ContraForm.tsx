import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { buildContraLines, contraMoneyAccounts, resolveBankChargesAccountId } from '@/lib/contra'
import { categoryPath } from '@/lib/categoryHierarchy'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
import { publicErrorMessage, safeErrorMessage } from '@/lib/security'
import { SubmissionLock } from '@/lib/submissionLock'
import type { Voucher } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { VoucherNumberField } from '@/components/forms/VoucherNumberField'
import { stableFormSnapshot, useUnsavedChangesGuard } from '@/lib/unsavedChanges'
import { Printer } from 'lucide-react'
import { beginVoucherPrint, cancelVoucherPrint, completeVoucherPrint, useVoucherShortcuts, type VoucherPrintRequest } from '@/lib/voucherShortcuts'

type ContraDraft = { sourceAccountId?: string; destinationAccountId?: string; amount?: number; chargeAmount?: number; narration?: string; dateBs?: string; journalInvoiceNo?: string }

function contraError(error: unknown) {
  const message = safeErrorMessage(error)
  if (/contra_(entry|destination|charge).*(does not exist|schema cache)|could not find.*contra_/i.test(message)) return 'Contra vouchers are not enabled in the database yet. Apply the Contra migration, then reload the app.'
  if (/^(select|transfer|enter|bank charge|the protected|complete financial year|voucher date|cannot save voucher)/i.test(message)) return message
  return publicErrorMessage(error, 'saving contra voucher')
}

export function ContraForm({ open, voucher, onClose }: { open: boolean; voucher?: Voucher | null; onClose: () => void }) {
  const { company, rawAccounts, accountCategories, saveContra, updateContra, saveDraftVoucher, deleteDraftVoucher } = useAppStore()
  const manualNumbering = company?.journal_numbering_mode === 'manual'
  const [dateBs, setDateBs] = useState(() => selectedFiscalYearEndBs(company))
  const [invoiceNo, setInvoiceNo] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [amount, setAmount] = useState(0)
  const [charge, setCharge] = useState(0)
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(new SubmissionLock()).current
  const initializedFormRef = useRef<string | null>(null)
  const baselineRef = useRef('')
  const snapshotRef = useRef('')
  const workingDraftIdRef = useRef<string | undefined>(voucher?.status === 'Draft' ? voucher.id : undefined)
  const freshAfterDraftRef = useRef(false)
  const accounts = useMemo(() => company ? contraMoneyAccounts(rawAccounts, accountCategories, company.id) : [], [company, rawAccounts, accountCategories])
  const options = accounts.map(account => ({ value: account.id, label: account.name, group: categoryPath(accountCategories, account.category_id) || account.group, searchText: `${account.name} ${categoryPath(accountCategories, account.category_id)} ${account.group}` }))

  useEffect(() => {
    const formIdentity = `Contra:${voucher?.id || 'new'}`
    if (!open) { initializedFormRef.current = null; baselineRef.current = ''; workingDraftIdRef.current = undefined; freshAfterDraftRef.current = false; return }
    if (initializedFormRef.current === formIdentity) return
    initializedFormRef.current = formIdentity
    baselineRef.current = ''
    workingDraftIdRef.current = voucher?.status === 'Draft' ? voucher.id : undefined
    freshAfterDraftRef.current = false
    const draft = (voucher?.draft_payload || {}) as ContraDraft
    const destinationLine = voucher?.lines?.find(line => line.account_id === voucher.contra_destination_account_id)
    setDateBs(draft.dateBs || voucher?.date_bs || selectedFiscalYearEndBs(company))
    setInvoiceNo(draft.journalInvoiceNo ?? voucher?.invoice_no ?? '')
    setSourceId(draft.sourceAccountId || voucher?.settlement_account_id || '')
    setDestinationId(draft.destinationAccountId || voucher?.contra_destination_account_id || '')
    setAmount(Number(draft.amount ?? destinationLine?.debit ?? 0))
    setCharge(Number(draft.chargeAmount ?? voucher?.contra_charge_amount ?? 0))
    setNarration(draft.narration ?? voucher?.narration ?? '')
    setError('')
    window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
  }, [open, voucher, company])

  const formSnapshot = stableFormSnapshot({ dateBs, invoiceNo, sourceId, destinationId, amount, charge, narration })
  snapshotRef.current = formSnapshot
  const dirty = open && baselineRef.current !== '' && formSnapshot !== baselineRef.current
  const confirmDiscard = useUnsavedChangesGuard(open, dirty)

  const params = () => ({ source_account_id: sourceId, destination_account_id: destinationId, amount, charge_amount: charge, narration: narration.trim(), date_bs: dateBs, invoice_no: manualNumbering ? invoiceNo.trim() : undefined })
  const validate = () => {
    if (!company) throw new Error('No company selected.')
    if (manualNumbering && !invoiceNo.trim()) throw new Error('Enter the Journal voucher number.')
    buildContraLines(params(), rawAccounts, accountCategories, company.id, resolveBankChargesAccountId(rawAccounts, company.id))
  }
  const complete = async (shouldPrint = false) => {
    try { validate() } catch (caught) { setError(contraError(caught)); return }
    if (!lock.tryAcquire()) return
    let printRequest: VoucherPrintRequest | undefined = shouldPrint ? beginVoucherPrint() : undefined
    setSaving(true); setError('')
    try { const targetVoucherId = freshAfterDraftRef.current ? undefined : (voucher?.id || workingDraftIdRef.current); if (targetVoucherId) await updateContra(targetVoucherId, params(), 'Completed'); else await saveContra(params(), 'Completed'); workingDraftIdRef.current = undefined; completeVoucherPrint(printRequest, 'Journal', voucher); printRequest = undefined; onClose() }
    catch (caught) { cancelVoucherPrint(printRequest); setError(contraError(caught)) }
    finally { lock.release(); setSaving(false) }
  }
  useVoucherShortcuts({ open, disabled: saving, draftDisabled: saving, onSave: () => { void complete() }, onSaveAndPrint: () => { void complete(true) }, onSaveDraft: !voucher || voucher.status === 'Draft' ? () => { void saveDraft() } : undefined })
  const saveDraft = async () => {
    if (voucher && voucher.status !== 'Draft') return setError('Completed Contra vouchers cannot be saved as draft.')
    setSaving(true); setError('')
    try {
      await saveDraftVoucher({ id: freshAfterDraftRef.current ? undefined : (workingDraftIdRef.current || (voucher?.status === 'Draft' ? voucher.id : undefined)), type: 'Journal', date_bs: dateBs, narration, total: amount + charge, settlement_account_id: sourceId || null, contra_entry: true, contra_destination_account_id: destinationId || null, contra_charge_amount: charge, draft_payload: { journalEntryType: 'Contra', sourceAccountId: sourceId, destinationAccountId: destinationId, amount, chargeAmount: charge, narration, dateBs, journalInvoiceNo: invoiceNo } })
      workingDraftIdRef.current = undefined; freshAfterDraftRef.current = true; baselineRef.current = ''
      setDateBs(selectedFiscalYearEndBs(company)); setInvoiceNo(''); setSourceId(''); setDestinationId(''); setAmount(0); setCharge(0); setNarration(''); setError('')
      window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
    } catch (caught) { setError(contraError(caught)) } finally { setSaving(false) }
  }
  const removeDraft = async () => { if (!voucher || voucher.status !== 'Draft') return; setSaving(true); try { await deleteDraftVoucher(voucher.id); onClose() } catch (caught) { setError(publicErrorMessage(caught, 'deleting Contra draft')) } finally { setSaving(false) } }

  return <Dialog open={open} onOpenChange={next => { if (!next) void confirmDiscard().then(confirmed => { if (confirmed) onClose() }) }}><DialogContent className="voucher-dialog max-h-[88vh] max-w-2xl overflow-y-auto">
    <DialogHeader><DialogTitle>{voucher && !freshAfterDraftRef.current ? 'Edit' : 'Add'} Contra</DialogTitle></DialogHeader>
    <p className="-mt-2 text-sm text-muted-foreground">Move money seamlessly between your Cash and Bank ledgers.</p>
    <div className="space-y-4 py-2">
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Date</Label><NepaliDateInput value={dateBs} onChange={setDateBs} min={selectedFiscalYearStartBs(company)} max={selectedFiscalYearEndBs(company)} /></div>{manualNumbering ? <div className="space-y-1.5"><Label>Voucher Number</Label><Input value={invoiceNo} onChange={event => setInvoiceNo(event.target.value)} /></div> : <VoucherNumberField type="Journal" dateBs={dateBs} voucher={voucher} />}</div>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Transfer From <span className="text-destructive">*</span></Label><SearchableSelect value={sourceId} onValueChange={setSourceId} placeholder="Select Cash or Bank" options={options} /></div><div className="space-y-1.5"><Label>Transfer To <span className="text-destructive">*</span></Label><SearchableSelect value={destinationId} onValueChange={setDestinationId} placeholder="Select Cash or Bank" options={options.filter(option => option.value !== sourceId)} /></div></div>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Transfer Amount <span className="text-destructive">*</span></Label><Input type="number" min="0" step="0.01" value={amount || ''} onChange={event => setAmount(Number(event.target.value))} placeholder="0.00" /></div><div className="space-y-1.5"><Label>Bank Charge (optional)</Label><Input type="number" min="0" step="0.01" value={charge || ''} onChange={event => setCharge(Number(event.target.value))} placeholder="0.00" /></div></div>
      <div className="space-y-1.5"><Label>Note</Label><Textarea value={narration} onChange={event => setNarration(event.target.value)} rows={2} placeholder="Transfer reference or details" /></div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
    <DialogFooter>{voucher?.status === 'Draft' && !freshAfterDraftRef.current && <Button variant="destructive" disabled={saving} onClick={removeDraft}>Delete Draft</Button>}<Button variant="outline" onClick={() => void confirmDiscard().then(confirmed => { if (confirmed) onClose() })}>Cancel</Button>{(!voucher || voucher.status === 'Draft') && <Button variant="outline" disabled={saving} onClick={saveDraft}>{voucher && !freshAfterDraftRef.current ? 'Update Draft' : 'Save as Draft'}<kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+D</kbd></Button>}<Button disabled={saving} onClick={() => complete()} title="Save voucher (Alt+S)">{saving ? 'Saving...' : voucher && voucher.status !== 'Draft' ? 'Save Changes' : 'Complete Contra'}{!saving && <kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+S</kbd>}</Button><Button variant="outline" disabled={saving} onClick={() => complete(true)} title="Save and print (Alt+P)"><Printer className="mr-1 h-4 w-4" />Save &amp; Print<kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+P</kbd></Button></DialogFooter>
  </DialogContent></Dialog>
}
