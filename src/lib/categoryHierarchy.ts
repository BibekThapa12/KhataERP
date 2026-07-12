export interface CategoryLike {
  id: string
  name: string
  parent_category_id?: string | null
  is_archived: boolean
}

export interface CategorizedRecord { category_id?: string }

export interface CategoryTreeNode<C extends CategoryLike, R extends CategorizedRecord> {
  category: C
  depth: 1 | 2 | 3
  path: string
  directRecords: R[]
  children: CategoryTreeNode<C, R>[]
  directCount: number
  totalCount: number
}

export function categoryDescendantIds<C extends CategoryLike>(categories: C[], id: string) {
  const result = new Set<string>()
  const visit = (parentId: string) => categories.filter(category => category.parent_category_id === parentId).forEach(category => { if (!result.has(category.id)) { result.add(category.id); visit(category.id) } })
  visit(id)
  return result
}

export function categoryDepth<C extends CategoryLike>(categories: C[], id: string): number {
  const byId = new Map(categories.map(category => [category.id, category]))
  const seen = new Set<string>()
  let current = byId.get(id)
  let depth = 1
  while (current?.parent_category_id) {
    if (seen.has(current.id)) return 99
    seen.add(current.id)
    depth += 1
    current = byId.get(current.parent_category_id)
  }
  return depth
}

export function categoryPath<C extends CategoryLike>(categories: C[], id?: string | null) {
  if (!id) return ''
  const byId = new Map(categories.map(category => [category.id, category]))
  const names: string[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) { names.unshift(current.name); seen.add(current.id); current = current.parent_category_id ? byId.get(current.parent_category_id) : undefined }
  return names.join(' › ')
}

export function subtreeHeight<C extends CategoryLike>(categories: C[], id: string): number {
  const children = categories.filter(category => category.parent_category_id === id)
  return children.length ? 1 + Math.max(...children.map(child => subtreeHeight(categories, child.id))) : 1
}

export function buildCategoryTree<C extends CategoryLike, R extends CategorizedRecord>(categories: C[], records: R[]): CategoryTreeNode<C, R>[] {
  const build = (category: C, depth: number, parentPath: string): CategoryTreeNode<C, R> => {
    const path = parentPath ? `${parentPath} › ${category.name}` : category.name
    const directRecords = records.filter(record => record.category_id === category.id)
    const children = categories.filter(child => child.parent_category_id === category.id).sort((a, b) => a.name.localeCompare(b.name)).map(child => build(child, depth + 1, path))
    return { category, depth: Math.min(depth, 3) as 1 | 2 | 3, path, directRecords, children, directCount: directRecords.length, totalCount: directRecords.length + children.reduce((sum, child) => sum + child.totalCount, 0) }
  }
  return categories.filter(category => !category.parent_category_id || !categories.some(parent => parent.id === category.parent_category_id)).sort((a, b) => a.name.localeCompare(b.name)).map(category => build(category, 1, ''))
}

export function flattenCategoryTree<C extends CategoryLike, R extends CategorizedRecord>(nodes: CategoryTreeNode<C, R>[]): CategoryTreeNode<C, R>[] {
  return nodes.flatMap(node => [node, ...flattenCategoryTree(node.children)])
}
