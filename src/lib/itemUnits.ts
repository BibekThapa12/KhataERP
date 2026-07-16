export interface ErpUnitDefinition {
  value: string
  label: string
  group: string
  aliases?: string
}

export const ERP_ITEM_UNITS: readonly ErpUnitDefinition[] = [
  { value: 'Pcs', label: 'Pieces (Pcs)', group: 'Count', aliases: 'piece pc pcs number unit' },
  { value: 'Nos', label: 'Numbers (Nos)', group: 'Count', aliases: 'number no nos unit' },
  { value: 'Pair', label: 'Pair', group: 'Count', aliases: 'pairs' },
  { value: 'Set', label: 'Set', group: 'Count', aliases: 'sets' },
  { value: 'Dozen', label: 'Dozen', group: 'Count', aliases: 'doz 12 pieces' },
  { value: 'Box', label: 'Box', group: 'Packaging', aliases: 'boxes' },
  { value: 'Carton', label: 'Carton', group: 'Packaging', aliases: 'ctn cartons' },
  { value: 'Case', label: 'Case', group: 'Packaging', aliases: 'cs cases' },
  { value: 'Pack', label: 'Pack', group: 'Packaging', aliases: 'packs' },
  { value: 'Packet', label: 'Packet', group: 'Packaging', aliases: 'pkt packets' },
  { value: 'Bag', label: 'Bag', group: 'Packaging', aliases: 'bags sack sacks' },
  { value: 'Bundle', label: 'Bundle', group: 'Packaging', aliases: 'bundles' },
  { value: 'Bale', label: 'Bale', group: 'Packaging', aliases: 'bales' },
  { value: 'Crate', label: 'Crate', group: 'Packaging', aliases: 'crates' },
  { value: 'Pallet', label: 'Pallet', group: 'Packaging', aliases: 'pallets' },
  { value: 'Roll', label: 'Roll', group: 'Packaging', aliases: 'rolls' },
  { value: 'Reel', label: 'Reel', group: 'Packaging', aliases: 'reels' },
  { value: 'Drum', label: 'Drum', group: 'Packaging', aliases: 'drums barrel barrels' },
  { value: 'Can', label: 'Can', group: 'Packaging', aliases: 'cans' },
  { value: 'Bottle', label: 'Bottle', group: 'Packaging', aliases: 'btl bottles' },
  { value: 'Jar', label: 'Jar', group: 'Packaging', aliases: 'jars' },
  { value: 'Tube', label: 'Tube', group: 'Packaging', aliases: 'tubes' },
  { value: 'Tin', label: 'Tin', group: 'Packaging', aliases: 'tins' },
  { value: 'mg', label: 'Milligram (mg)', group: 'Weight', aliases: 'milligrams' },
  { value: 'g', label: 'Gram (g)', group: 'Weight', aliases: 'grams gm' },
  { value: 'kg', label: 'Kilogram (kg)', group: 'Weight', aliases: 'kilograms kgs' },
  { value: 'Quintal', label: 'Quintal', group: 'Weight', aliases: 'qtl 100 kg' },
  { value: 'Tonne', label: 'Tonne', group: 'Weight', aliases: 'ton tonnes metric ton' },
  { value: 'ml', label: 'Millilitre (ml)', group: 'Volume', aliases: 'milliliter millilitres' },
  { value: 'L', label: 'Litre (L)', group: 'Volume', aliases: 'liter litre litres ltr' },
  { value: 'kL', label: 'Kilolitre (kL)', group: 'Volume', aliases: 'kiloliter kilolitre' },
  { value: 'Gallon', label: 'Gallon', group: 'Volume', aliases: 'gal gallons' },
  { value: 'mm', label: 'Millimetre (mm)', group: 'Length', aliases: 'millimeter millimetres' },
  { value: 'cm', label: 'Centimetre (cm)', group: 'Length', aliases: 'centimeter centimetres' },
  { value: 'm', label: 'Metre (m)', group: 'Length', aliases: 'meter metres' },
  { value: 'km', label: 'Kilometre (km)', group: 'Length', aliases: 'kilometer kilometres' },
  { value: 'Inch', label: 'Inch', group: 'Length', aliases: 'in inches' },
  { value: 'Foot', label: 'Foot', group: 'Length', aliases: 'feet ft' },
  { value: 'Yard', label: 'Yard', group: 'Length', aliases: 'yards yd' },
  { value: 'sq ft', label: 'Square Foot (sq ft)', group: 'Area', aliases: 'square feet sqft' },
  { value: 'sq m', label: 'Square Metre (sq m)', group: 'Area', aliases: 'square meter sqm' },
  { value: 'Acre', label: 'Acre', group: 'Area', aliases: 'acres' },
  { value: 'Hectare', label: 'Hectare', group: 'Area', aliases: 'hectares ha' },
  { value: 'Hour', label: 'Hour', group: 'Service / Other', aliases: 'hours hr hrs' },
  { value: 'Day', label: 'Day', group: 'Service / Other', aliases: 'days' },
  { value: 'Month', label: 'Month', group: 'Service / Other', aliases: 'months' },
  { value: 'Job', label: 'Job', group: 'Service / Other', aliases: 'jobs service' },
  { value: 'Lot', label: 'Lot', group: 'Service / Other', aliases: 'lots batch' },
] as const

export function isKnownItemUnit(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return !!normalized && ERP_ITEM_UNITS.some(unit => unit.value.toLowerCase() === normalized)
}

export function canonicalItemUnit(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return ERP_ITEM_UNITS.find(unit => unit.value.toLowerCase() === normalized)?.value || null
}

export function isValidCustomItemUnit(value: string): boolean {
  const unit = value.trim()
  if (unit.length < 1 || unit.length > 20) return false
  if (unit.startsWith('__')) return false
  return /^[\p{L}\p{N}][\p{L}\p{N}\s./°%_-]*$/u.test(unit)
}

export function validateItemUnits(mainUnit: string, alternateUnit?: string | null, legacyUnits: string[] = []): string | null {
  const main = mainUnit.trim()
  const alternate = alternateUnit?.trim() || ''
  const permittedLegacy = legacyUnits.map(unit => unit.trim().toLowerCase())
  const permitted = (unit: string) => isKnownItemUnit(unit) || isValidCustomItemUnit(unit) || permittedLegacy.includes(unit.toLowerCase())
  if (!main) return 'Select a main unit.'
  if (!permitted(main)) return 'Main unit must be 1–20 characters and contain only letters, numbers, spaces, or standard unit symbols.'
  if (alternate && !permitted(alternate)) return 'Alternative unit must be 1–20 characters and contain only letters, numbers, spaces, or standard unit symbols.'
  if (alternate && alternate.toLowerCase() === main.toLowerCase()) return 'Main and alternative units must be different.'
  return null
}
