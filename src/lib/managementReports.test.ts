import { describe, expect, it } from 'vitest'
import type { Account, AccountCategory, Party, Voucher } from '@/types'
import { categoryAccountIds, getCashBankBook, getGroupReport, getOutstandingReport, getRegister, getTransactionRegister } from '@/lib/managementReports'
import { adToBs, bsToAd } from '@/lib/nepaliDate'

const companyId = 'company'
const account = (id: string, name: string, type: Account['type'], category_id: string, opening_balance = 0): Account => ({ id, company_id: companyId, name, type, group: category_id, category_id, opening_balance, balance: opening_balance, is_party: id.startsWith('party'), is_system: false })
const category = (id: string, name: string, account_type: Account['type'], parent_category_id?: string): AccountCategory => ({ id, company_id: companyId, name, account_type, parent_category_id, is_system: false, is_archived: false })
const voucher = (id: string, type: Voucher['type'], date_bs: string, total: number, lines: Voucher['lines'], extra: Partial<Voucher> = {}): Voucher => ({ id, company_id: companyId, type, date: '2026-07-01', date_ad: '2026-07-01', date_bs, date_bs_key: Number(date_bs.replace(/-/g, '')), total, lines, is_cash: false, cancelled: false, seq: Number(id.replace(/\D/g, '')) || 1, ...extra })
const daysBefore = (bsDate: string, days: number) => {
  const [year, month, day] = bsToAd(bsDate).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day - days))
  return adToBs(date.toISOString().slice(0, 10))
}

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

  it('does not carry previous-year Expense balances into group openings', () => {
    const expenseCategories = [category('expenses', 'Expenses', 'Expense'), category('indirect', 'Indirect Expenses', 'Expense', 'expenses')]
    const expenseAccounts = [account('rent', 'Rent', 'Expense', 'indirect', 500), account('power', 'Power', 'Expense', 'indirect', 0)]
    const movements = [
      voucher('v1', 'Journal', '2083-03-31', 100, [{ account_id: 'rent', debit: 100, credit: 0 }]),
      voucher('v2', 'Journal', '2083-04-15', 40, [{ account_id: 'rent', debit: 25, credit: 0 }, { account_id: 'power', debit: 15, credit: 0 }]),
    ]
    const report = getGroupReport('expenses', expenseCategories, expenseAccounts, movements, '2083-05-01', '2083-05-31', false, '2083-04-01')

    expect(report.opening).toBe(40)
    expect(report.summary.map(row => [row.account.id, row.opening])).toEqual([['power', 15], ['rent', 25]])
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

  it('keeps sales and sales returns in separate registers', () => {
    const party: Party = { id:'p1', company_id:companyId, name:'A Store', type:'customer', account_id:'party-c' }
    const invoice = voucher('i1','Sales','2083-04-01',100,[{account_id:'party-c',debit:100,credit:0}],{party_account_id:'party-c',subtotal:90,vat_amount:10})
    const returned = voucher('sr1','Sales Return','2083-04-02',25,[{account_id:'party-c',debit:0,credit:25}],{party_account_id:'party-c',original_voucher_id:'i1',settlement_mode:'party'})
    expect(getOutstandingReport('receivable',[party],accounts,[invoice,returned],'2083-04-20').total_outstanding).toBe(75)
    const salesRegister = getRegister('sales',[invoice,returned],[party],'2083-04-01','2083-04-30')
    const returnRegister = getRegister('sales-return',[invoice,returned],[party],'2083-04-01','2083-04-30')
    expect(salesRegister.rows.map(row => row.voucher.id)).toEqual(['i1'])
    expect(salesRegister.net).toBe(100)
    expect(returnRegister.rows.map(row => row.voucher.id)).toEqual(['sr1'])
    expect(returnRegister.rows[0].voucher.type).toBe('Sales Return')
    expect(returnRegister.rows[0].voucher.date_bs).toBe('2083-04-02')
    expect(returnRegister.returns).toBe(25)
    expect(returnRegister.net).toBe(25)
  })

  it('keeps purchases and purchase returns in separate registers', () => {
    const supplier: Party = { id:'s1', company_id:companyId, name:'Supplier Co', type:'supplier', account_id:'party-s' }
    const bill = voucher('p1','Purchase','2083-04-01',300,[{account_id:'party-s',debit:0,credit:300}],{party_account_id:'party-s',subtotal:280,vat_amount:20})
    const returned = voucher('pr1','Purchase Return','2083-04-02',60,[{account_id:'party-s',debit:60,credit:0}],{party_account_id:'party-s',original_voucher_id:'p1',subtotal:55,vat_amount:5})

    expect(getRegister('purchase',[bill,returned],[supplier],'2083-04-01','2083-04-30').rows.map(row => row.voucher.id)).toEqual(['p1'])
    const returnRegister = getRegister('purchase-return',[bill,returned],[supplier],'2083-04-01','2083-04-30')
    expect(returnRegister.rows.map(row => row.voucher.id)).toEqual(['pr1'])
    expect(returnRegister.net).toBe(60)
  })

  it('ages supplier bills and reconciles payments on the credit side', () => {
    const supplierAccount = account('party-s','Supplier','Liability','current')
    const supplier: Party = { id:'s1', company_id:companyId, name:'Supplier Co', type:'supplier', account_id:'party-s' }
    const bill = voucher('p1','Purchase','2083-04-01',300,[{account_id:'party-s',debit:0,credit:300}],{party_account_id:'party-s',due_date_bs:'2083-04-10'})
    const payment = voucher('pay1','Payment','2083-04-15',100,[{account_id:'party-s',debit:100,credit:0},{account_id:'cash',debit:0,credit:100}])
    const report = getOutstandingReport('payable',[supplier],[...accounts,supplierAccount],[bill,payment],'2083-04-20')
    expect(report.total_outstanding).toBe(200)
    expect(report.net_ledger_balance).toBe(200)
    expect(report.summaries[0].ledger_balance).toBe(200)
  })

  it('uses exact ageing boundaries and keeps future documents not due', () => {
    const party: Party = { id:'p1', company_id:companyId, name:'A Store', type:'customer', account_id:'party-c' }
    const asOf = '2083-08-15'
    const ages = [-1,0,30,31,60,61,90,91]
    const invoices = ages.map((age, index) => voucher(`age${index + 1}`,'Sales',daysBefore(asOf, Math.max(age, 0)),10,[{account_id:'party-c',debit:10,credit:0}],{
      party_account_id:'party-c',
      due_date_bs: age < 0 ? adToBs(new Date(new Date(bsToAd(asOf)).getTime() + 86400000).toISOString().slice(0,10)) : daysBefore(asOf, age),
    }))
    const report = getOutstandingReport('receivable',[party],accounts,invoices,asOf)
    expect(report.buckets).toEqual({ 'Not Due':20, '1-30':10, '31-60':20, '61-90':20, '90+':10 })
    expect(report.documents.find(row => row.age_days === 0)?.status).toBe('Due Today')
  })

  it('moves a zero-credit invoice out of Not Due when the as-of date advances', () => {
    const party: Party = { id:'p1', company_id:companyId, name:'Rama Kirana', type:'customer', account_id:'party-c' }
    const invoice = voucher('zero1','Sales','2083-03-30',35000,[{account_id:'party-c',debit:35000,credit:0}],{
      party_account_id:'party-c', credit_days:0, due_date_bs:'2083-04-30',
    })
    const dueToday = getOutstandingReport('receivable',[party],accounts,[invoice],'2083-03-30')
    const nextDay = getOutstandingReport('receivable',[party],accounts,[invoice],'2083-03-31')
    expect(dueToday.documents[0]).toMatchObject({ due_date_bs:'2083-03-30', age_days:0, bucket:'Not Due', status:'Due Today' })
    expect(nextDay.documents[0]).toMatchObject({ due_date_bs:'2083-03-30', age_days:1, bucket:'1-30', status:'Overdue' })
  })

  it('separates opening balances and journals from aged documents', () => {
    const partyAccount = account('party-opening','Opening Customer','Asset','current',25)
    const party: Party = { id:'po', company_id:companyId, name:'Opening Customer', type:'customer', account_id:'party-opening' }
    const invoice = voucher('oi1','Sales','2083-04-01',100,[{account_id:'party-opening',debit:100,credit:0}],{party_account_id:'party-opening'})
    const journal = voucher('oj1','Journal','2083-04-02',15,[{account_id:'party-opening',debit:15,credit:0},{account_id:'cash',debit:0,credit:15}],{narration:'Balance correction'})
    const report = getOutstandingReport('receivable',[party],[...accounts,partyAccount],[invoice,journal],'2083-04-20')
    expect(report.total_adjustments).toBe(40)
    expect(report.net_ledger_balance).toBe(140)
    expect(report.summaries[0].adjustment_rows.map(row => [row.kind,row.amount])).toEqual([['opening',25],['journal',15]])
  })

  it('combines a partial return and payment without ageing either as an invoice', () => {
    const party: Party = { id:'p1', company_id:companyId, name:'A Store', type:'customer', account_id:'party-c' }
    const invoice = voucher('mix1','Sales','2083-04-01',200,[{account_id:'party-c',debit:200,credit:0}],{party_account_id:'party-c',due_date_bs:'2083-04-05'})
    const returned = voucher('mixr1','Sales Return','2083-04-04',50,[{account_id:'party-c',debit:0,credit:50}],{party_account_id:'party-c',original_voucher_id:'mix1',settlement_mode:'party'})
    const receipt = voucher('mixpay1','Receipt','2083-04-06',60,[{account_id:'cash',debit:60,credit:0},{account_id:'party-c',debit:0,credit:60}])
    const report = getOutstandingReport('receivable',[party],accounts,[invoice,returned,receipt],'2083-04-20')
    expect(report.documents[0]).toMatchObject({ original_amount:200, returns:50, settled:60, outstanding:90 })
    expect(report.documents[0].return_vouchers.map(row => row.id)).toEqual(['mixr1'])
  })

  it('falls back from invalid due dates and does not crash on fully invalid dates', () => {
    const party: Party = { id:'p1', company_id:companyId, name:'A Store', type:'customer', account_id:'party-c' }
    const fallback = voucher('bad1','Sales','2083-04-01',50,[{account_id:'party-c',debit:50,credit:0}],{party_account_id:'party-c',due_date_bs:'not-a-date'})
    const invalid = voucher('bad2','Sales','invalid',25,[{account_id:'party-c',debit:25,credit:0}],{party_account_id:'party-c',due_date_bs:'invalid',date_bs_key:1})
    const report = getOutstandingReport('receivable',[party],accounts,[fallback,invalid],'2083-04-20')
    expect(report.documents.find(row => row.voucher.id === 'bad1')?.due_date_source).toBe('invoice-date')
    expect(report.documents.find(row => row.voucher.id === 'bad2')).toMatchObject({ due_date_source:'invalid', bucket:'Not Due', status:'Not Due' })
  })

  it('reconciles gross, unapplied, and adjustments to the net ledger balance', () => {
    const partyAccount = account('party-recon','Recon Customer','Asset','current',20)
    const party: Party = { id:'pr', company_id:companyId, name:'Recon Customer', type:'customer', account_id:'party-recon' }
    const invoice = voucher('ri1','Sales','2083-04-01',100,[{account_id:'party-recon',debit:100,credit:0}],{party_account_id:'party-recon'})
    const receipt = voucher('rr1','Receipt','2083-04-02',130,[{account_id:'cash',debit:130,credit:0},{account_id:'party-recon',debit:0,credit:130}])
    const report = getOutstandingReport('receivable',[party],[...accounts,partyAccount],[invoice,receipt],'2083-04-20')
    expect(report.total_outstanding).toBe(0)
    expect(report.total_unapplied).toBe(30)
    expect(report.total_adjustments).toBe(20)
    expect(report.net_ledger_balance).toBe(-10)
    expect(report.total_outstanding - report.total_unapplied + report.total_adjustments).toBe(report.net_ledger_balance)
    expect(report.unapplied_rows[0]).toMatchObject({ amount:30 })
  })

  it('excludes invoices, settlements, returns, and journals after the as-of date', () => {
    const party: Party = { id:'p1', company_id:companyId, name:'A Store', type:'customer', account_id:'party-c' }
    const invoice = voucher('as1','Sales','2083-04-01',100,[{account_id:'party-c',debit:100,credit:0}],{party_account_id:'party-c'})
    const laterInvoice = voucher('as2','Sales','2083-04-21',200,[{account_id:'party-c',debit:200,credit:0}],{party_account_id:'party-c'})
    const laterReceipt = voucher('asr1','Receipt','2083-04-22',100,[{account_id:'cash',debit:100,credit:0},{account_id:'party-c',debit:0,credit:100}])
    const report = getOutstandingReport('receivable',[party],accounts,[invoice,laterInvoice,laterReceipt],'2083-04-20')
    expect(report.documents.map(row => row.voucher.id)).toEqual(['as1'])
    expect(report.total_outstanding).toBe(100)
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
