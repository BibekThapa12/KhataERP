import { describe, expect, it } from 'vitest'
import { canTransitionCheque, chequeEntitlement, chequeRelativeState, filterPendingCheques, validateChequeInput } from './cheques'
import type { Cheque, CompanyModule } from '@/types'

const cheque = (overrides: Partial<Cheque> = {}): Cheque => ({
  id:'c1', company_id:'company', cheque_number:'000123', bank_id:'bank', account_number:'00101', party_ledger_id:'party', amount:100,
  issue_date:'2026-07-15', issue_date_bs:'2083-03-31', issue_date_bs_key:20830331,
  due_date:'2026-07-18', due_date_bs:'2083-04-03', due_date_bs_key:20830403, status:'pending', ...overrides,
})

const entitlement = (overrides: Partial<CompanyModule> = {}): CompanyModule => ({
  id:'cm', company_id:'company', module_id:'module', is_enabled:true, status:'active', billing_type:'included', price:0,
  payment_status:'waived', settings:{}, module:{id:'module',key:'cheque_management',name:'Cheque Management',default_price:0,is_active:true}, ...overrides,
})

describe('cheque entitlement', () => {
  it('allows an enabled included module', () => expect(chequeEntitlement(entitlement()).canWrite).toBe(true))
  it('denies a disabled module', () => expect(chequeEntitlement(entitlement({is_enabled:false})).canRead).toBe(false))
  it('makes read-only status non-writable', () => expect(chequeEntitlement(entitlement({status:'read_only'})).canWrite).toBe(false))
})

describe('received cheque rules', () => {
  it('derives due and overdue states from B.S. dates', () => {
    expect(chequeRelativeState(cheque(), '2083-04-03').key).toBe('today')
    expect(chequeRelativeState(cheque(), '2083-04-04').key).toBe('overdue')
  })
  it('filters the next seven days', () => expect(filterPendingCheques([cheque()], '7', '2083-03-30')).toHaveLength(1))
  it('requires a positive amount and valid dates', () => {
    expect(validateChequeInput(cheque({amount:0}))).toMatch(/greater than zero/i)
    expect(validateChequeInput(cheque({due_date_bs:'2083-03-30'}))).toMatch(/cannot be before/i)
  })
  it('only allows pending terminal transitions', () => {
    expect(canTransitionCheque('pending','cleared')).toBe(true)
    expect(canTransitionCheque('cleared','bounced')).toBe(false)
  })
})
