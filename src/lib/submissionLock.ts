/** Immediate, render-independent guard for async form submissions. */
export class SubmissionLock {
  private active = false

  tryAcquire() {
    if (this.active) return false
    this.active = true
    return true
  }

  release() {
    this.active = false
  }

  get locked() {
    return this.active
  }
}
