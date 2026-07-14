import { describe, expect, it } from 'vitest'
import type { Account, AccountCategory, Party, Voucher } from '@/types'
import { categoryAccountIds, getCashBankBook, getGroupReport, getOutstandingReport, getRegister, getTransactionRegister } from '@/lib/managementReports'

const companyId = 'company'
const account = (id: string, name: string, type: Account['type'], category_id: string, opening_balance = 0): Account => ({ id, company_id: companyId, name, type, group: category_id, category_id, opening_balance, balance: opening_balance, is_party: id.startsWith('party'), is_system: false })
const category = (id: string, name: string, account_type: Account['type'], parent_category_id?: string): AccountCategory => ({ id, company_id: companyId, name, account_type, parent_category_id, is_system: false, is_archived: false })
const voucher = (id: string, type: Voucher['type'], date_bs: string, total: number, lines: Voucher['lines'], extra: Partial<Voucher> = {}): Voucher => ({ id, company_id: companyId, type, date: '2026-07-01', date_ad: '2026-07-01', date_bs, date_bs_key: Number(date_bs.replaceAll('-', '')), total, lines, is_cash: false, cancelled: false, seq: Number(id.replace(/\D/g, '')) || 1, ...extra })

describe('management reports', () => {
  const categories = [category('assets','Assets','Asset'), category('current','Current Assets','Asset','assets'), category('bank-group','Bank','Asset','current')]
  const accounts = [account('cash','Cash','Asset','current',100), account('bank','Bank','Asset','bank-group'), account('party-c','Customer','Asset','current')]

  it('includes direct and descendant ledgers exactly once', () => {
    expect([...categoryAccountIds('assets', categories, accounts)].sort()).toEqual(['bank','cash','party-c'])
  })

  it('reconciles group opening, movement, and closing on the natural side', () => {
    const vouchers = [
      voucher('v1','Receipt','2083-04-01',50,[{account_id:'cash',debit:50,credit:0},{account_id:'party-c',debit:0,credit:50}]),
      voucher('v2','Payment','2083-04-02',20,[{account_id:'cash',debit:0,credit:20},{account_id:'party-c',debit:20,credit:0}]),
      voucher('v3','Receipt','2083-04-03',30,[{account_id:'bank',debit:30,credit:0},{account_id:'party-c',debit:0,credit:30}]),
    ]
    const report = getGroupReport('assets', categories, accounts, vouchers, '2083-04-01','2083-04-30')
    expect(report.opening).toBe(100)
    expect(report.total_debit).toBe(100)
    expect(report.total_credit).toBe(100)
    expect(report.closing).toBe(100)
  })

  it('uses deterministic FIFO for legacy receipts and exposes overpayments', () => {
    const party: Party = { id:'p1', company_id:companyId, name:'A Store', type:'customer', account_id:'party-c' }
    const invoices = [
      voucher('i1','Sales','2083-04-01',100,[{account_id:'party-c',debit:100,credit:0}],{party_account_id:'party-c',due_date_bs:'2083-04-05',invoice_no:'INV-1'}),
      voucher('i2','Sales','2083-04-02',200,[{account_id:'party-c',debit:200,credit:0}],{party_account_id:'party-c',due_date_bs:'2083-04-10',invoice_no:'INV-2'}),
      voucher('r1','Receipt','2083-04-12',350,[{account_id:'cash',debit:350,credit:0},{account_id:'party-c',debit:0,credit:350}]),
    ]
    const report = getOutstandingReport('receivable',[party],accounts,invoices,'2083-04-20')
    expect(report.documents).toHaveLength(0)
    expect(report.total_unapplied).toBe(50)
    expect(report.summaries[0].ledger_balance).toBe(-50)
  })

  it('prefers stored allocations and ignores cancelled settlements', () => {
    const party: Party = { id:'p1', company_id:companyId, name:'A Store', type:'customer', account_id:'party-c' }
    const invoices = [
      voucher('i1','Sales','2083-04-01',100,[{account_id:'party-c',debit:100,credit:0}],{party_account_id:'party-c',due_date_bs:'2083-04-05'}),
      voucher('i2','Sales','2083-04-02',200,[{account_id:'party-c',debit:200,credit:0}],{party_account_id:'party-c',due_date_bs:'2083-04-10'}),
      voucher('r1','Receipt','2083-04-12',150,[{account_id:'cash',debit:150,credit:0},{account_id:'party-c',debit:0,credit:150}],{settlements:[{company_id:companyId,settlement_voucher_id:'r1',invoice_voucher_id:'i2',party_account_id:'party-c',amount:150}]}),
      voucher('r2','Receipt','2083-04-13',100,[{account_id:'cash',debit:100,credit:0},{account_id:'party-c',debit:0,credit:100}],{cancelled:true}),
    ]
    const report = getOutstandingReport('receivable',[party],accounts,invoices,'2083-04-20')
    expect(report.documents.find(row => row.voucher.id === 'i1')?.outstanding).toBe(100)
    expect(report.documents.find(row => row.voucher.id === 'i2')?.outstanding).toBe(50)
  })

  it('reduces outstanding and register net by party returns', () => {
    const party: Party = { id:'p1', company_id:companyId, name:'A Store', type:'customer', account_id:'party-c' }
    const invoice = voucher('i1','Sales','2083-04-01',100,[{account_id:'party-c',debit:100,credit:0}],{party_account_id:'party-c',subtotal:90,vat_amount:10})
    const returned = voucher('sr1','Sales Return','2083-04-02',25,[{account_id:'party-c',debit:0,credit:25}],{party_account_id:'party-c',original_voucher_id:'i1',settlement_mode:'party'})
    expect(getOutstandingReport('receivable',[party],accounts,[invoice,returned],'2083-04-20').total_outstanding).toBe(75)
    const register = getRegister('sales',[invoice,returned],[party],'2083-04-01','2083-04-30')
    expect(register.rows.map(row => row.voucher.id)).toEqual(['i1', 'sr1'])
    expect(register.rows[1].voucher.type).toBe('Sales Return')
    expect(register.rows[1].voucher.date_bs).toBe('2083-04-02')
    expect(register.returns).toBe(25)
    expect(register.net).toBe(75)
  })

  it('builds receipt, payment, and journal registers from voucher lines', () => {
    const party: Party = { id:'p1', company_id:companyId, name:'A Store', type:'customer', account_id:'party-c' }
    const receipt = voucher('r1','Receipt','2083-04-03',75,[{account_id:'cash',debit:75,credit:0},{account_id:'party-c',debit:0,credit:75}],{narration:'Part payment'})
    const journal = voucher('j1','Journal','2083-04-04',20,[{account_id:'bank',debit:20,credit:0},{account_id:'cash',debit:0,credit:20}])
    const receiptReport = getTransactionRegister('receipt',[receipt,journal],accounts,[party],'2083-04-01','2083-04-30')
    expect(receiptReport.rows).toHaveLength(1)
    expect(receiptReport.rows[0].particulars).toBe('A Store')
    expect(receiptReport.total_amount).toBe(75)
    const journalReport = getTransactionRegister('journal',[receipt,journal],accounts,[party],'2083-04-01','2083-04-30')
    expect(journalReport.rows[0].particulars).toBe('Bank, Cash')
    expect(journalReport.total_debit).toBe(20)
    expect(journalReport.total_credit).toBe(20)
  })

  it('shows cash-to-bank transfers without changing the combined closing balance', () => {
    const transfer = voucher('j1','Journal','2083-04-05',40,[{account_id:'bank',debit:40,credit:0},{account_id:'cash',debit:0,credit:40}])
    const report = getCashBankBook(companyId,null,accounts,categories,[transfer],'2083-04-01','2083-04-30')
    expect(report.rows[0].activity).toBe('Transfer')
    expect(report.opening).toBe(100)
    expect(report.closing).toBe(100)
  })
})
