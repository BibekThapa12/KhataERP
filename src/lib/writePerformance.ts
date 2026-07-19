export interface WriteTraceContext {
  operation: string
  companyId: string
  recordType: string
  lineItems?: number
}

interface WriteStageOptions {
  dbFunction?: string
  query?: boolean
  category?: 'frontend' | 'network_database' | 'cache' | 'ui'
}

interface WritePerformanceSample extends WriteTraceContext {
  traceId: string
  stage: string
  category: NonNullable<WriteStageOptions['category']> | 'total'
  durationMs: number
  success: boolean
  queryCount: number
  dbFunction?: string
  errorName?: string
}

const STORAGE_KEY = 'khataerp:write-performance'

function writeTracingEnabled() {
  if (!import.meta.env.DEV) return false
  if (import.meta.env.VITE_WRITE_PERF === 'true') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function timestamp() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function report(sample: WritePerformanceSample) {
  // Intentionally structured and payload-free. Do not add names, amounts,
  // narration, account numbers, or other business data to these samples.
  const { companyId: _companyId, ...nonIdentifyingSample } = sample
  console.info('[KhataERP write performance]', nonIdentifyingSample)
}

export class WritePerformanceTrace {
  readonly enabled: boolean
  readonly traceId: string
  private readonly startedAt: number
  private queryCount = 0
  private finished = false

  constructor(readonly context: WriteTraceContext) {
    this.enabled = writeTracingEnabled()
    this.traceId = crypto.randomUUID()
    this.startedAt = timestamp()
  }

  sync<T>(stage: string, task: () => T, options: WriteStageOptions = {}): T {
    if (!this.enabled) return task()
    const startedAt = timestamp()
    try {
      const result = task()
      this.emit(stage, timestamp() - startedAt, true, options)
      return result
    } catch (error) {
      this.emit(stage, timestamp() - startedAt, false, options, error)
      throw error
    }
  }

  async measure<T>(stage: string, task: () => Promise<T>, options: WriteStageOptions = {}): Promise<T> {
    if (!this.enabled) return task()
    const startedAt = timestamp()
    try {
      const result = await task()
      this.emit(stage, timestamp() - startedAt, true, options)
      return result
    } catch (error) {
      this.emit(stage, timestamp() - startedAt, false, options, error)
      throw error
    }
  }

  finish(success = true, error?: unknown) {
    if (!this.enabled || this.finished) return
    this.finished = true
    report({
      ...this.context,
      traceId: this.traceId,
      stage: 'total',
      category: 'total',
      durationMs: Number((timestamp() - this.startedAt).toFixed(2)),
      success,
      queryCount: this.queryCount,
      errorName: error instanceof Error ? error.name : undefined,
    })
  }

  private emit(stage: string, duration: number, success: boolean, options: WriteStageOptions, error?: unknown) {
    if (options.query) this.queryCount += 1
    report({
      ...this.context,
      traceId: this.traceId,
      stage,
      category: options.category || 'frontend',
      durationMs: Number(duration.toFixed(2)),
      success,
      queryCount: this.queryCount,
      dbFunction: options.dbFunction,
      errorName: error instanceof Error ? error.name : undefined,
    })
  }
}

export function beginWriteTrace(context: WriteTraceContext) {
  return new WritePerformanceTrace(context)
}

export function enableWritePerformanceTracing() {
  if (!import.meta.env.DEV) return
  window.localStorage.setItem(STORAGE_KEY, '1')
}

export function disableWritePerformanceTracing() {
  window.localStorage.removeItem(STORAGE_KEY)
}
