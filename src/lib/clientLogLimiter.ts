const DEFAULT_DEDUPLICATION_MS = 5 * 60 * 1000
const DEFAULT_SESSION_LIMIT = 30

export class ClientLogLimiter {
  private readonly recent = new Map<string, number>()
  private accepted = 0

  constructor(
    private readonly deduplicationMs = DEFAULT_DEDUPLICATION_MS,
    private readonly sessionLimit = DEFAULT_SESSION_LIMIT,
  ) {}

  shouldAccept(fingerprint: string, now = Date.now()) {
    if (this.accepted >= this.sessionLimit) return false
    const previous = this.recent.get(fingerprint)
    if (previous !== undefined && now - previous < this.deduplicationMs) return false

    for (const [key, timestamp] of this.recent) {
      if (now - timestamp >= this.deduplicationMs) this.recent.delete(key)
    }
    this.recent.set(fingerprint, now)
    this.accepted += 1
    return true
  }
}
