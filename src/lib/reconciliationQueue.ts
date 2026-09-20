/** Coalesces refresh requests but always rereads after an in-flight read is invalidated. */
export class ReconciliationQueue {
  private pending = new Map<string, { revision: number; promise: Promise<void> }>()

  pendingRequest(key: string): Promise<void> | undefined {
    return this.pending.get(key)?.promise
  }

  request(key: string, read: () => Promise<() => void>, onError: (error: unknown) => void): Promise<void> {
    const existing = this.pending.get(key)
    if (existing) {
      existing.revision++
      return existing.promise
    }
    const entry = { revision: 0, promise: Promise.resolve() }
    this.pending.set(key, entry)
    entry.promise = (async () => {
      for (;;) {
        const revision = entry.revision
        try {
          const publish = await read()
          if (revision !== entry.revision) continue
          publish()
        } catch (error) {
          if (revision !== entry.revision) continue
          onError(error)
        }
        break
      }
    })().finally(() => { if (this.pending.get(key) === entry) this.pending.delete(key) })
    return entry.promise
  }
}
