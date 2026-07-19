import type { Cheque, ChequePermission, ChequeStatus, CompanyModule } from '@/types'
import { bsToAd, makeBsKey, todayBs } from '@/lib/nepaliDate'

export const ALL_CHEQUE_PERMISSIONS: ChequePermission[] = ['cheque.view','cheque.create','cheque.edit','cheque.mark_cleared','cheque.mark_bounced','cheque.cancel','cheque.manage_banks','cheque.view_parties','cheque.view_reports']
export const DEFAULT_CHEQUE_SETTINGS = { enable_dashboard_widgets:true, allow_due_date_before_issue_date:false, default_upcoming_days:7, require_status_reason_for_bounce:true, require_status_reason_for_cancel:true, allow_account_number_override:false, enable_cheque_notifications:false, enable_read_only_after_expiry:true }

export function chequeEntitlement(entitlement?: CompanyModule | null) {
  if (!entitlement?.is_enabled || entitlement.module?.key !== 'cheque_management' || entitlement.module?.is_active === false) return { canRead:false, canWrite:false, reason:'Cheque Management is not enabled for this company.' }
  const today = new Date().toISOString().slice(0,10)
  const started = !entitlement.starts_at || entitlement.starts_at <= today
  const expired = !!entitlement.expires_at && entitlement.expires_at < today
  const settings = { ...DEFAULT_CHEQUE_SETTINGS, ...(entitlement.settings || {}) }
  const statusReadable = ['active','trial','grace_period','read_only'].includes(entitlement.status)
  const canRead = started && statusReadable && entitlement.payment_status !== 'cancelled' && (!expired || !!settings.enable_read_only_after_expiry)
  const paidForWrite = entitlement.status === 'trial' || entitlement.billing_type === 'included' || ['paid','waived'].includes(entitlement.payment_status)
  const canWrite = canRead && !expired && ['active','trial'].includes(entitlement.status) && paidForWrite
  return { canRead, canWrite, reason: !started ? 'The module start date has not arrived.' : expired ? 'The module has expired.' : !statusReadable ? 'The module is disabled.' : entitlement.payment_status === 'cancelled' ? 'Module payment is cancelled.' : 'Cheque Management is read-only.', settings }
}

export function chequeRelativeState(cheque: Cheque, today=todayBs()) {
  if (cheque.status !== 'pending') return { key:cheque.status, label:cheque.status.replace(/^./, c=>c.toUpperCase()), days:0 }
  const day = 86400000
  const diff = Math.round((new Date(bsToAd(cheque.due_date_bs)).getTime()-new Date(bsToAd(today)).getTime())/day)
  if (diff===0) return { key:'today', label:'Due Today', days:0 }
  if (diff<0) return { key:'overdue', label:`${Math.abs(diff)} Day${diff===-1?'':'s'} Overdue`, days:diff }
  return { key:'upcoming', label:`Due in ${diff} Day${diff===1?'':'s'}`, days:diff }
}

export function validateChequeInput(input: Pick<Cheque,'cheque_number'|'account_number'|'party_ledger_id'|'bank_id'|'amount'|'issue_date_bs'|'due_date_bs'>, allowEarlyDue=false) {
  if (!/^[A-Za-z0-9][A-Za-z0-9 /._-]{0,49}$/.test(input.cheque_number.trim())) return 'Enter a valid cheque number (letters, numbers, spaces, /, ., _, or -).'
  if (!input.bank_id) return 'Select a bank.'
  if (!input.account_number.trim()) return 'Enter the account number.'
  if (!input.party_ledger_id) return 'Select a party ledger.'
  if (!Number.isFinite(input.amount) || input.amount<=0) return 'Amount must be greater than zero.'
  if (!input.issue_date_bs || !input.due_date_bs) return 'Enter issue and due dates.'
  if (!allowEarlyDue && makeBsKey(input.due_date_bs)<makeBsKey(input.issue_date_bs)) return 'Due date cannot be before issue date.'
  return ''
}

export function canTransitionCheque(from:ChequeStatus,to:ChequeStatus) { return from==='pending' && ['cleared','bounced','cancelled'].includes(to) }

export function filterPendingCheques(cheques:Cheque[], quick:string, today=todayBs()) {
  return cheques.filter(cheque => {
    const relative=chequeRelativeState(cheque,today)
    if (quick==='overdue') return relative.key==='overdue'
    if (quick==='today') return relative.key==='today'
    if (quick==='7') return cheque.status==='pending' && relative.days>=0 && relative.days<=7
    if (quick==='30') return cheque.status==='pending' && relative.days>=0 && relative.days<=30
    return cheque.status==='pending'
  }).sort((a,b) => {
    const rank=(c:Cheque)=>{const key=chequeRelativeState(c,today).key; return key==='overdue'?0:key==='today'?1:2}
    return rank(a)-rank(b)||a.due_date_bs_key-b.due_date_bs_key
  })
}

export function filterSettledCheques(cheques: Cheque[], status: ChequeStatus | 'all' = 'all') {
  const settled = cheques.filter(cheque => cheque.status !== 'pending' && (status === 'all' || cheque.status === status))
  const settledAt = (cheque: Cheque) => cheque.cleared_at || cheque.bounced_at || cheque.cancelled_at || cheque.updated_at || cheque.created_at || ''
  return settled.sort((left, right) => settledAt(right).localeCompare(settledAt(left)))
}
