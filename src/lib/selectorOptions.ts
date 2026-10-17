import type { SearchableSelectOption } from '@/components/inputs/SearchableSelect'
import type { Account, AccountCategory, ChequeBank, Item, ItemCategory, Party } from '@/types'
import { categoryPath } from '@/lib/categoryHierarchy'

const details = (...values: Array<string | null | undefined | false>) => values.filter(Boolean).join(' · ')

export function itemSelectorOption(item: Item, stockText?: string): SearchableSelectOption {
  const units = item.is_service ? 'Service' : details(item.unit, item.alternate_unit ? `Alt: ${item.alternate_unit}` : '')
  const availableStock = stockText || (!item.is_service && item.stock_qty !== undefined ? `${item.stock_qty} ${item.unit}` : undefined)
  return {
    value: item.id,
    label: item.name,
    secondaryText: details(item.sku ? `SKU ${item.sku}` : '', item.barcode ? `Barcode ${item.barcode}` : '', units),
    trailingText: availableStock,
    searchText: details(item.name, item.sku, item.barcode, item.unit, item.alternate_unit, item.is_service && 'service'),
    disabled: !!item.is_archived,
  }
}

export function partySelectorOption(party: Party, account?: Account): SearchableSelectOption {
  return {
    value: party.account_id,
    label: party.name,
    secondaryText: details(party.phone || account?.contact_no, party.pan_vat || account?.pan_no ? `PAN ${party.pan_vat || account?.pan_no}` : '', party.address || account?.address),
    searchText: details(party.name, party.phone, party.pan_vat, party.address, account?.name, account?.contact_no, account?.pan_no, account?.address, account?.group),
    disabled: !!party.is_archived,
  }
}

export function ledgerSelectorOption(account: Account, categories: AccountCategory[], party?: Party): SearchableSelectOption {
  const path = categoryPath(categories, account.category_id) || account.group || account.type
  return {
    value: account.id,
    label: account.name,
    group: path,
    secondaryText: details(account.type, party?.phone || account.contact_no, party?.pan_vat || account.pan_no ? `PAN ${party?.pan_vat || account.pan_no}` : ''),
    searchText: details(account.name, path, account.group, account.type, account.bank_account_no, party?.name, party?.phone, party?.pan_vat, party?.address),
    disabled: !!account.is_archived || !!party?.is_archived,
  }
}

export function categorySelectorOption(category: ItemCategory | AccountCategory, categories: Array<ItemCategory | AccountCategory>): SearchableSelectOption {
  const parentPath = category.parent_category_id ? categoryPath(categories, category.parent_category_id) : 'Top level'
  return {
    value: category.id,
    label: category.name,
    secondaryText: parentPath,
    searchText: categoryPath(categories, category.id),
    group: 'account_type' in category ? category.account_type : undefined,
    disabled: !!category.is_archived,
  }
}

export function chequeBankSelectorOption(bank: ChequeBank): SearchableSelectOption {
  return {
    value: bank.id,
    label: bank.bank_name,
    group: bank.institution_type || 'Other',
    secondaryText: details(bank.branch_name, bank.account_number ? `A/C ${bank.account_number}` : '', bank.account_holder_name),
    searchText: details(bank.bank_name, bank.institution_type, bank.branch_name, bank.account_number, bank.account_holder_name),
    disabled: !bank.is_active,
  }
}

export function sortSelectorOptions(options: SearchableSelectOption[]) {
  return [...options].sort((left, right) => (left.group || '').localeCompare(right.group || '') || left.label.localeCompare(right.label))
}
