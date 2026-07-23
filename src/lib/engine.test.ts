import { describe, expect, it } from 'vitest'
import {
  buildPaymentData, buildPurchaseVoucherData, buildReceiptData, buildReturnVoucherData,
  applyVoucherBalanceDelta, buildSalesVoucherData, computeBalanceSheet, computeProfitAndLoss, computeStockConditionSummary, computeStockLedger, computeStockSummary, computeTrialBalance, defaultChartOfAccounts, recomputeAffectedBalances, recomputeAffectedStock, recomputeAllBalances, recomputeFiscalTrialAccounts, recomputeStock, stockConditionQuantity, validateBalanced,
} from './engine'
import type { Account, Item, Voucher, VoucherLine } from '@/types'
import { formatStockQuantity, fromBaseRate, toBaseQty, toBaseRate } from './units'

const accounts = { cash: 'c:cash', sales: 'c:sales', purchase: 'c:purchase', vat_payable: 'c:vatp', vat_receivable: 'c:vatr' }

describe('accounting engine integrity', () => {
  it('posts a VAT sale as a balanced journal', () => {
    const result = buildSalesVoucherData({ party_account_id: null, is_cash: true, items: [{ item_id: 'tea', qty: 2, rate: 100 }], discount: 10, vat_rate: 13, system_accounts: accounts })
    expect(result).toMatchObject({ subtotal: 200, discount: 10, vat_amount: 24.7, total: 214.7 })
    expect(validateBalanced(result.lines)).toMatchObject({ valid: true, total_debit: 214.7, total_credit: 214.7 })
  })

  it('posts purchases, receipts, and payments as balanced journals', () => {
    const purchase = buildPurchaseVoucherData({ party_account_id: 'supplier', is_cash: false, items: [{ item_id: 'tea', qty: 3, rate: 50 }], vat_rate: 13, system_accounts: accounts })
    expect(validateBalanced(purchase.lines).valid).toBe(true)
    expect(validateBalanced(buildReceiptData([{ account_id: 'customer', amount: 500 }], 'cash').lines).valid).toBe(true)
    expect(validateBalanced(buildPaymentData([{ account_id: 'supplier', amount: 300 }], 'cash').lines).valid).toBe(true)
  })

  it('posts zero-value sales, purchases, and returns while preserving item quantities', () => {
    const item = { item_id: 'sample', qty: 2, rate: 0 }
    const sale = buildSalesVoucherData({ party_account_id: null, is_cash: true, items: [item], vat_rate: 13, system_accounts: accounts })
    const purchase = buildPurchaseVoucherData({ party_account_id: 'supplier', is_cash: false, items: [item], vat_rate: 13, system_accounts: accounts })
    const salesReturn = buildReturnVoucherData({
      type: 'Sales Return', party_account_id: 'customer', items: [{ ...item, cost_rate: 25 }],
      settlement_mode: 'party', restock_items: true, stock_condition: 'saleable',
      system_accounts: { sales_return: 'sales-return' },
    })
    const purchaseReturn = buildReturnVoucherData({
      type: 'Purchase Return', party_account_id: 'supplier', items: [{ ...item, cost_rate: 25 }],
      settlement_mode: 'party', restock_items: true, stock_condition: 'saleable',
      system_accounts: { purchase_return: 'purchase-return' },
    })

    for (const result of [sale, purchase, salesReturn, purchaseReturn]) {
      expect(result.total).toBe(0)
      expect(result.invoice_items[0]).toMatchObject({ item_id: 'sample', qty: 2, rate: 0 })
      expect(result.stock_lines[0]).toMatchObject({ item_id: 'sample', qty: 2 })
      expect(validateBalanced(result.lines as VoucherLine[]).valid).toBe(true)
    }
  })

  it('keeps input and output VAT as signed liability balances', () => {
    const chart = defaultChartOfAccounts('c').map(account => ({ ...account, balance: 0 })) as Account[]
    const inputVat = chart.find(account => account.id === 'c:vat_receivable')!
    const outputVat = chart.find(account => account.id === 'c:vat_payable')!
    expect(inputVat).toMatchObject({ type: 'Liability', group: 'Duties & Taxes' })
    expect(outputVat).toMatchObject({ type: 'Liability', group: 'Duties & Taxes' })
    const voucher = { id: 'vat', company_id: 'c', type: 'Journal', date_bs: '2083-01-01', date_bs_key: 20830101, seq: 1, total: 0, cancelled: false, lines: [
      { account_id: inputVat.id, debit: 130, credit: 0 },
      { account_id: outputVat.id, debit: 0, credit: 200 },
    ] } as Voucher
    const balances = recomputeAllBalances(chart, [voucher])
    expect(balances.find(account => account.id === inputVat.id)?.balance).toBe(-130)
    expect(balances.find(account => account.id === outputVat.id)?.balance).toBe(200)
  })

  it('recomputes affected ledgers with the same result as a full replay', () => {
    const chart = defaultChartOfAccounts('c').map(account => ({ ...account, balance: 0 })) as Account[]
    const current = recomputeAllBalances(chart, [])
    const voucher = { id: 'sale', company_id: 'c', type: 'Sales', date_bs: '2083-01-01', date_bs_key: 20830101, seq: 1, total: 100, cancelled: false, lines: [
      { account_id: 'c:cash', debit: 100, credit: 0 },
      { account_id: 'c:sales', debit: 0, credit: 100 },
    ] } as Voucher
    expect(recomputeAffectedBalances(chart, current, [voucher], ['c:cash', 'c:sales']))
      .toEqual(recomputeAllBalances(chart, [voucher]))
  })

  it('applies create, edit, and cancellation balance deltas without replaying history', () => {
    const chart = defaultChartOfAccounts('c').map(account => ({ ...account, balance: 0 })) as Account[]
    const created = { id: 'sale', company_id: 'c', type: 'Sales', date_bs: '2083-01-01', date_bs_key: 20830101, seq: 1, total: 100, cancelled: false, lines: [
      { account_id: 'c:cash', debit: 100, credit: 0 }, { account_id: 'c:sales', debit: 0, credit: 100 },
    ] } as Voucher
    const edited = { ...created, total: 150, lines: [
      { account_id: 'c:cash', debit: 150, credit: 0 }, { account_id: 'c:sales', debit: 0, credit: 150 },
    ] }
    const afterEdit = applyVoucherBalanceDelta(applyVoucherBalanceDelta(chart, undefined, created), created, edited)
    expect(afterEdit).toEqual(recomputeAllBalances(chart, [edited]))
    expect(applyVoucherBalanceDelta(afterEdit, edited, { ...edited, cancelled: true })).toEqual(recomputeAllBalances(chart, []))
  })

  it('posts multiple ledger allocations against one settlement account', () => {
    const receipt = buildReceiptData([{ account_id: 'customer-a', amount: 1000 }, { account_id: 'income', amount: 500 }], 'bank-a')
    expect(receipt).toMatchObject({ total: 1500, lines: [
      { account_id: 'bank-a', debit: 1500, credit: 0 },
      { account_id: 'customer-a', debit: 0, credit: 1000 },
      { account_id: 'income', debit: 0, credit: 500 },
    ] })
    expect(validateBalanced(receipt.lines).valid).toBe(true)

    const payment = buildPaymentData([{ account_id: 'supplier-a', amount: 700 }, { account_id: 'expense', amount: 300 }], 'cash')
    expect(payment.lines.at(-1)).toEqual({ account_id: 'cash', debit: 0, credit: 1000 })
    expect(validateBalanced(payment.lines).valid).toBe(true)
  })

  it('maintains weighted-average stock cost and ignores cancelled vouchers', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 10, opening_rate: 10 } as Item
    const voucher = (seq: number, cancelled: boolean, direction: 'in' | 'out', qty: number, rate: number) => ({ id: String(seq), company_id: 'c', type: 'Purchase', date: '2026-01-01', date_ad: '2026-01-01', date_bs: '2082-09-17', date_bs_key: 20820917, is_cash: true, total: 0, cancelled, seq, stock_lines: [{ item_id: 'tea', direction, qty, rate }] }) as Voucher
    const [stock] = recomputeStock([item], [voucher(1, false, 'in', 10, 20), voucher(2, false, 'out', 5, 999), voucher(3, true, 'in', 100, 1)])
    expect(stock).toMatchObject({ qty: 15, avg_cost: 15, value: 225 })
  })

  it('summarizes opening, inward, outward, and closing stock', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 10, opening_rate: 10 } as Item
    const voucher = (seq: number, cancelled: boolean, direction: 'in' | 'out', qty: number, rate: number) => ({ id: String(seq), company_id: 'c', type: 'Purchase', date: '2026-01-01', date_ad: '2026-01-01', date_bs: '2082-09-17', date_bs_key: 20820917, is_cash: true, total: 0, cancelled, seq, stock_lines: [{ item_id: 'tea', direction, qty, rate }] }) as Voucher
    const [row] = computeStockSummary([item], [voucher(1, false, 'in', 10, 20), voucher(2, false, 'out', 5, 999), voucher(3, true, 'in', 100, 1)])
    expect(row).toMatchObject({
      opening_qty: 10, opening_value: 100,
      inward_qty: 10, inward_value: 200,
      outward_qty: 5, outward_value: 75,
      closing_qty: 15, closing_rate: 15, closing_value: 225,
    })
  })

  it('supports perpetual weighted-average, FIFO, and LIFO valuation', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 10, opening_rate: 10 } as Item
    const voucher = (id: string, seq: number, type: Voucher['type'], direction: 'in' | 'out', qty: number, rate: number, original_voucher_id?: string) => ({ id, company_id: 'c', type, date: '2026-01-01', date_ad: '2026-01-01', date_bs: '2082-09-17', date_bs_key: 20820917, original_voucher_id, is_cash: true, total: 0, cancelled: false, seq, stock_lines: [{ item_id: 'tea', direction, qty, rate }] }) as Voucher
    const purchasesAndSale = [voucher('purchase', 1, 'Purchase', 'in', 10, 20), voucher('sale', 2, 'Sales', 'out', 5, 999)]

    expect(recomputeStock([item], purchasesAndSale, 'weighted_average')[0]).toMatchObject({ qty: 15, avg_cost: 15, value: 225 })
    expect(recomputeStock([item], purchasesAndSale, 'fifo')[0]).toMatchObject({ qty: 15, avg_cost: 16.67, value: 250 })
    expect(recomputeStock([item], purchasesAndSale, 'lifo')[0]).toMatchObject({ qty: 15, avg_cost: 13.33, value: 200 })

    const withSalesReturn = [...purchasesAndSale, voucher('return', 3, 'Sales Return', 'in', 2, 0, 'sale')]
    expect(recomputeStock([item], withSalesReturn, 'fifo')[0]).toMatchObject({ qty: 17, value: 270 })
    expect(recomputeStock([item], withSalesReturn, 'lifo')[0]).toMatchObject({ qty: 17, value: 240 })
  })

  it('replays affected stock only while preserving exact FIFO results', () => {
    const tea = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 10, opening_rate: 10 } as Item
    const coffee = { ...tea, id: 'coffee', name: 'Coffee', opening_rate: 30 }
    const purchase = { id: 'purchase', company_id: 'c', type: 'Purchase', date_bs: '2083-01-01', date_bs_key: 20830101, seq: 1, total: 0, cancelled: false, stock_lines: [{ item_id: 'tea', direction: 'in', qty: 10, rate: 20 }] } as Voucher
    const current = recomputeStock([tea, coffee], [], 'fifo')
    const affected = recomputeAffectedStock([tea, coffee], current, [purchase], ['tea'], 'fifo')
    expect(affected).toEqual(recomputeStock([tea, coffee], [purchase], 'fifo'))
    expect(affected.find(entry => entry.id === 'coffee')).toEqual(current.find(entry => entry.id === 'coffee'))
  })

  it('builds a period stock ledger with valuation-cost movements and running balances', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 10, opening_rate: 10 } as Item
    const voucher = (id: string, seq: number, date_bs: string, type: Voucher['type'], direction: 'in' | 'out', qty: number, rate: number, extra: Record<string, unknown> = {}) => ({ id, company_id: 'c', type, date: '2026-01-01', date_ad: '2026-01-01', date_bs, date_bs_key: Number(date_bs.replaceAll('-', '')), is_cash: true, total: 0, cancelled: false, seq, stock_lines: [{ item_id: 'tea', direction, qty, rate }], ...extra }) as Voucher
    const vouchers = [
      voucher('purchase', 1, '2082-09-16', 'Purchase', 'in', 10, 20),
      voucher('sale', 2, '2082-09-17', 'Sales', 'out', 5, 999),
      voucher('cancelled', 3, '2082-09-17', 'Purchase', 'in', 100, 1, { cancelled: true }),
      voucher('draft', 4, '2082-09-17', 'Purchase', 'in', 100, 1, { status: 'draft' }),
    ]
    const fifo = computeStockLedger(item, vouchers, '2082-09-17', '2082-09-17', 'fifo')
    expect(fifo).toMatchObject({ opening_qty: 20, opening_value: 300, outward_qty: 5, outward_value: 50, closing_qty: 15, closing_value: 250 })
    expect(fifo.movements).toHaveLength(1)
    expect(fifo.movements[0]).toMatchObject({ voucher_id: 'sale', outward_rate: 10, outward_value: 50, balance_qty: 15, balance_rate: 16.67, balance_value: 250 })
    const weighted = computeStockLedger(item, vouchers, '2082-09-17', '2082-09-17', 'weighted_average')
    expect(weighted).toMatchObject({ outward_value: 75, closing_value: 225 })
  })

  it('moves stock between saleable, damaged, and expired conditions without changing total inventory', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 10, opening_rate: 20 } as Item
    const transfer = (id: string, seq: number, destination: 'damaged' | 'expired', qty: number) => ({
      id, company_id: 'c', type: 'Stock Adjustment', date_bs: `2083-04-0${seq}`, date_bs_key: 20830400 + seq, is_cash: false, total: 0, cancelled: false, seq,
      stock_lines: [
        { item_id: 'tea', direction: 'out', qty, rate: 20, stock_condition: 'saleable', is_transfer: true },
        { item_id: 'tea', direction: 'in', qty, rate: 20, stock_condition: destination, is_transfer: true },
      ],
    }) as Voucher
    const vouchers = [transfer('damage', 1, 'damaged', 3), transfer('expiry', 2, 'expired', 2)]

    expect(recomputeStock([item], vouchers)[0]).toMatchObject({ qty: 10, value: 200 })
    expect(stockConditionQuantity([item], vouchers, item.id, 'saleable')).toBe(5)
    expect(stockConditionQuantity([item], vouchers, item.id, 'damaged')).toBe(3)
    expect(stockConditionQuantity([item], vouchers, item.id, 'expired')).toBe(2)
    expect(computeStockConditionSummary([item], vouchers, 'damaged')[0]).toMatchObject({ closing_qty: 3, closing_rate: 20, closing_value: 60 })
  })

  it('posts return stock to or from the selected condition', () => {
    const original = {
      id: 'invoice', company_id: 'c', type: 'Sales', date_bs: '2083-04-01', date_bs_key: 20830401, seq: 1,
      party_account_id: 'party', is_cash: false, subtotal: 100, discount: 0, vat_rate: 0, total: 100, cancelled: false,
      invoice_items: [{ id: 'source', voucher_id: 'invoice', item_id: 'tea', qty: 1, rate: 100 }],
    } as Voucher
    const item = { source_invoice_item_id: 'source', item_id: 'tea', qty: 1, rate: 100, cost_rate: 60 }
    const systemAccounts = { sales_return: 'sales-return', purchase_return: 'purchase-return', vat_payable: 'vat-payable', vat_receivable: 'vat-receivable' }

    const salesReturn = buildReturnVoucherData({ type: 'Sales Return', original, items: [item], settlement_mode: 'party', restock_items: true, stock_condition: 'damaged', system_accounts: systemAccounts })
    const purchaseReturn = buildReturnVoucherData({ type: 'Purchase Return', original: { ...original, type: 'Purchase' }, items: [item], settlement_mode: 'party', restock_items: true, stock_condition: 'expired', system_accounts: systemAccounts })

    expect(salesReturn.stock_lines[0]).toMatchObject({ direction: 'in', stock_condition: 'damaged' })
    expect(purchaseReturn.stock_lines[0]).toMatchObject({ direction: 'out', stock_condition: 'expired' })
  })

  it('builds a balanced manual return without an original bill', () => {
    const result = buildReturnVoucherData({
      type: 'Sales Return',
      party_account_id: 'customer',
      vat_rate: 13,
      items: [{ item_id: 'tea', item_name: 'Tea', qty: 2, rate: 100, cost_rate: 60, conversion_factor: 1 }],
      settlement_mode: 'party',
      restock_items: true,
      stock_condition: 'saleable',
      system_accounts: { sales_return: 'sales-return', vat_payable: 'vat-payable' },
    })

    expect(result).toMatchObject({ subtotal: 200, discount: 0, vat_rate: 13, vat_amount: 26, total: 226 })
    expect(result.lines).toEqual([
      { account_id: 'sales-return', debit: 200, credit: 0 },
      { account_id: 'vat-payable', debit: 26, credit: 0 },
      { account_id: 'customer', debit: 0, credit: 226 },
    ])
    expect(result.stock_lines[0]).toMatchObject({ item_id: 'tea', qty: 2, rate: 60, direction: 'in' })
    expect(validateBalanced(result.lines as VoucherLine[]).valid).toBe(true)
  })

  it('resets nominal accounts at fiscal year start and carries prior results into equity', () => {
    const chart = defaultChartOfAccounts('c').map(account => ({ ...account, balance: 0 })) as Account[]
    const cash = chart.find(account => account.id === 'c:cash')!
    const sales = chart.find(account => account.id === 'c:sales')!
    const expense = chart.find(account => account.id === 'c:rent')!
    const historicalSale = { id: 'sale', company_id: 'c', type: 'Journal', date_bs: '2082-03-30', date_bs_key: 20820330, seq: 1, total: 100, cancelled: false, lines: [
      { account_id: cash.id, debit: 100, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100 },
    ] } as Voucher
    const currentExpense = { id: 'expense', company_id: 'c', type: 'Journal', date_bs: '2082-04-02', date_bs_key: 20820402, seq: 2, total: 20, cancelled: false, lines: [
      { account_id: expense.id, debit: 20, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 20 },
    ] } as Voucher

    const balances = recomputeFiscalTrialAccounts(chart, [historicalSale, currentExpense], '2082-04-01', 'c')

    expect(balances.find(account => account.id === sales.id)?.balance).toBe(0)
    expect(balances.find(account => account.id === expense.id)?.balance).toBe(20)
    expect(balances.find(account => account.id === 'c:retained_earnings')?.balance).toBe(100)
    expect(computeTrialBalance(balances)).toMatchObject({ total_debit: 100, total_credit: 100, balanced: true })
  })

  it('carries prior closing inventory into Current Assets and includes it in prior profit', () => {
    const chart = defaultChartOfAccounts('c').map(account => ({ ...account, balance: 0 })) as Account[]
    const cash = chart.find(account => account.id === 'c:cash')!
    const sales = chart.find(account => account.id === 'c:sales')!
    const purchase = chart.find(account => account.id === 'c:purchase')!
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 0, opening_rate: 0 } as Item
    const priorPurchase = { id: 'purchase', company_id: 'c', type: 'Purchase', date_bs: '2082-03-01', date_bs_key: 20820301, seq: 1, total: 100, cancelled: false, lines: [
      { account_id: purchase.id, debit: 100, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 100 },
    ], stock_lines: [{ item_id: item.id, direction: 'in', qty: 10, rate: 10 }] } as Voucher
    const priorSale = { id: 'sale', company_id: 'c', type: 'Sales', date_bs: '2082-03-15', date_bs_key: 20820315, seq: 2, total: 60, cancelled: false, lines: [
      { account_id: cash.id, debit: 60, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 60 },
    ], stock_lines: [{ item_id: item.id, direction: 'out', qty: 5, rate: 10 }] } as Voucher

    const balances = recomputeFiscalTrialAccounts(chart, [priorPurchase, priorSale], '2082-04-01', 'c', 'retained', [item], 'weighted_average', 'current-assets')

    expect(balances.find(account => account.id === 'c:opening-stock-report')).toMatchObject({
      name: 'Opening Stock (Previous Fiscal Year Closing)',
      type: 'Asset',
      balance: 50,
      category_id: 'current-assets',
    })
    expect(balances.find(account => account.id === 'c:retained_earnings')?.balance).toBe(10)
    expect(computeTrialBalance(balances)).toMatchObject({ total_debit: 50, total_credit: 50, balanced: true })
  })

  it('does not create retained earnings from undated item opening stock', () => {
    const chart = defaultChartOfAccounts('c').map(account => ({ ...account, balance: 0 })) as Account[]
    const item = { id: 'opening-item', company_id: 'c', name: 'Opening Item', unit: 'pc', sell_rate: 0, opening_qty: 10, opening_rate: 1800 } as Item

    const balances = recomputeFiscalTrialAccounts(chart, [], '2082-04-01', 'c', 'retained', [item], 'weighted_average', 'current-assets')

    expect(balances.find(account => account.id === 'c:retained_earnings')?.balance).toBe(0)
    expect(balances.find(account => account.id === 'c:opening-stock-report')).toMatchObject({
      balance: 18000,
      category_id: 'current-assets',
    })
  })

  it('uses only the immediately previous fiscal year for retained earnings', () => {
    const chart = defaultChartOfAccounts('c').map(account => ({ ...account, balance: 0 })) as Account[]
    const cash = chart.find(account => account.id === 'c:cash')!
    const sales = chart.find(account => account.id === 'c:sales')!
    const olderSale = { id: 'older-sale', company_id: 'c', type: 'Journal', date_bs: '2080-05-01', date_bs_key: 20800501, seq: 1, total: 500, cancelled: false, lines: [
      { account_id: cash.id, debit: 500, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 500 },
    ] } as Voucher

    const balances = recomputeFiscalTrialAccounts(chart, [olderSale], '2082-04-01', 'c')

    expect(balances.find(account => account.id === 'c:retained_earnings')?.balance).toBe(0)
  })

  it('ignores nominal master openings when calculating retained earnings', () => {
    const chart = defaultChartOfAccounts('c').map(account => ({ ...account, balance: 0 })) as Account[]
    const expense = chart.find(account => account.id === 'c:rent')!
    expense.opening_balance = 18000

    const balances = recomputeFiscalTrialAccounts(chart, [], '2082-04-01', 'c')

    expect(balances.find(account => account.id === 'c:retained_earnings')?.balance).toBe(0)
  })

  it('shows prior profit as retained earnings and only current profit in the balance sheet P&L', () => {
    const chart = defaultChartOfAccounts('c').map(account => ({ ...account, balance: 0 })) as Account[]
    const cash = chart.find(account => account.id === 'c:cash')!
    const sales = chart.find(account => account.id === 'c:sales')!
    const purchase = chart.find(account => account.id === 'c:purchase')!
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 0, opening_rate: 0 } as Item
    const vouchers = [
      { id: 'purchase', company_id: 'c', type: 'Purchase', date_bs: '2082-03-01', date_bs_key: 20820301, seq: 1, total: 100, cancelled: false, lines: [{ account_id: purchase.id, debit: 100, credit: 0 }, { account_id: cash.id, debit: 0, credit: 100 }], stock_lines: [{ item_id: item.id, direction: 'in', qty: 10, rate: 10 }] },
      { id: 'prior-sale', company_id: 'c', type: 'Sales', date_bs: '2082-03-15', date_bs_key: 20820315, seq: 2, total: 60, cancelled: false, lines: [{ account_id: cash.id, debit: 60, credit: 0 }, { account_id: sales.id, debit: 0, credit: 60 }], stock_lines: [{ item_id: item.id, direction: 'out', qty: 5, rate: 10 }] },
      { id: 'current-sale', company_id: 'c', type: 'Sales', date_bs: '2082-04-15', date_bs_key: 20820415, seq: 3, total: 60, cancelled: false, lines: [{ account_id: cash.id, debit: 60, credit: 0 }, { account_id: sales.id, debit: 0, credit: 60 }], stock_lines: [{ item_id: item.id, direction: 'out', qty: 2, rate: 10 }] },
    ] as Voucher[]
    const fiscalAccounts = recomputeFiscalTrialAccounts(chart, vouchers, '2082-04-01', 'c', 'retained', [item], 'weighted_average', 'current-assets')
    const openingStock = fiscalAccounts.find(account => account.id === 'c:opening-stock-report')?.balance || 0
    const reportAccounts = fiscalAccounts.filter(account => account.id !== 'c:opening-stock-report')
    const closingStock = recomputeStock([item], vouchers)[0].value
    const currentPnl = computeProfitAndLoss(reportAccounts, closingStock - openingStock)
    const balanceSheet = computeBalanceSheet(reportAccounts, currentPnl.net_profit, closingStock)

    expect(fiscalAccounts.find(account => account.id === 'c:retained_earnings')).toMatchObject({ name: 'Retained Earnings', balance: 10, category_id: 'retained', is_system: true })
    expect(currentPnl.net_profit).toBe(40)
    expect(balanceSheet).toMatchObject({ total_assets: 50, total_equity: 50, balanced: true })
  })

  it('builds a stock summary for the selected period with opening and closing balances', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 2, opening_rate: 10 } as Item
    const stockVoucher = (seq: number, direction: 'in' | 'out', qty: number, rate: number, date_bs: string) => ({ id: String(seq), company_id: 'c', type: 'Purchase', date: '2026-01-01', date_ad: '2026-01-01', date_bs, date_bs_key: Number(date_bs.replaceAll('-', '')), is_cash: true, total: 0, cancelled: false, seq, stock_lines: [{ item_id: 'tea', direction, qty, rate }] }) as Voucher
    const vouchers = [
      stockVoucher(1, 'in', 3, 20, '2082-01-01'),
      stockVoucher(2, 'in', 4, 30, '2082-02-01'),
      stockVoucher(3, 'out', 2, 999, '2082-02-15'),
      stockVoucher(4, 'in', 10, 40, '2082-03-01'),
    ]

    const [row] = computeStockSummary([item], vouchers, 'weighted_average', '2082-02-01', '2082-02-30')

    expect(row.opening_qty).toBe(5)
    expect(row.inward_qty).toBe(4)
    expect(row.outward_qty).toBe(2)
    expect(row.closing_qty).toBe(7)
  })

  it('removes an original purchase layer first for purchase returns', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 10, opening_rate: 10 } as Item
    const purchase = { id: 'purchase', company_id: 'c', type: 'Purchase', date: '2026-01-01', date_ad: '2026-01-01', date_bs: '2082-09-17', date_bs_key: 20820917, is_cash: true, total: 0, cancelled: false, seq: 1, stock_lines: [{ item_id: 'tea', direction: 'in', qty: 10, rate: 20 }] } as Voucher
    const returned = { ...purchase, id: 'return', type: 'Purchase Return', seq: 2, original_voucher_id: purchase.id, stock_lines: [{ item_id: 'tea', direction: 'out', qty: 3, rate: 20 }] } as Voucher
    expect(recomputeStock([item], [purchase, returned], 'fifo')[0]).toMatchObject({ qty: 17, value: 240 })
    expect(recomputeStock([item], [purchase, returned], 'lifo')[0]).toMatchObject({ qty: 17, value: 240 })
  })

  it('converts an alternative-unit invoice to canonical stock units', () => {
    const purchase = buildPurchaseVoucherData({ party_account_id: null, is_cash: true, items: [{ item_id: 'tea', qty: 12, rate: 100, entry_unit: 'pcs', conversion_factor: 12 }], vat_rate: 0, system_accounts: accounts })
    expect(purchase.subtotal).toBe(1200)
    expect(purchase.invoice_items[0]).toMatchObject({ qty: 12, rate: 100, entry_unit: 'pcs', conversion_factor: 12, base_qty: 1 })
    expect(purchase.stock_lines[0]).toMatchObject({ qty: 1, rate: 1200, direction: 'in' })
  })

  it('converts quantities and rates and formats equivalent stock', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'cs', alternate_unit: 'pcs', alternate_conversion: 6, sell_rate: 600, opening_qty: 0, opening_rate: 0 } as Item
    expect(toBaseQty(15, 6)).toBe(2.5)
    expect(toBaseRate(100, 6)).toBe(600)
    expect(fromBaseRate(600, 6)).toBe(100)
    expect(formatStockQuantity(2.5, item)).toBe('2.5 cs (15 pcs)')
    expect(formatStockQuantity(4, item)).toBe('4 cs (24 pcs)')
  })

  it.each([1, 10, 50, 100])('builds and validates a %i-line sales payload within the client budget', lineCount => {
    const started = performance.now()
    const result = buildSalesVoucherData({
      party_account_id: null,
      is_cash: true,
      items: Array.from({ length: lineCount }, (_, index) => ({ item_id: `item-${index}`, qty: index + 1, rate: 10 })),
      vat_rate: 13,
      system_accounts: accounts,
    })
    expect(result.invoice_items).toHaveLength(lineCount)
    expect(validateBalanced(result.lines).valid).toBe(true)
    expect(performance.now() - started).toBeLessThan(500)
  })
})
