export interface WriteTraceContext {
  operation: string
  companyId: string
  recordType: string
  lineItems?: number
  companySize?: number
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

export interface PersistedWritePerformanceSample {
  trace_id: string
  company_id: string
  operation: string
  record_type: string
  duration_ms: number
  success: boolean
  line_items: number
  query_count: number
  network_class?: string
  company_size_band: 'under_1k' | '1k_10k' | '10k_50k' | '50k_100k' | 'over_100k'
  app_version?: string
  error_code?: string
  stages: Array<{ stage: string; category: string; duration_ms: number; success: boolean }>
}

type PerformanceReporter = (sample: PersistedWritePerformanceSample) => void | Promise<void>
let performanceReporter: PerformanceReporter | undefined

export interface PerformanceIngestionStatus {
  state: 'success' | 'error'
  checked_at: string
  error_code?: string
}

const INGESTION_STATUS_KEY = 'khataerp:performance-ingestion-status'
const INGESTION_STATUS_EVENT = 'khataerp:performance-ingestion-status'

function updateIngestionStatus(status: PerformanceIngestionStatus) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(INGESTION_STATUS_KEY, JSON.stringify(status)) } catch { /* storage can be unavailable */ }
  window.dispatchEvent(new CustomEvent(INGESTION_STATUS_EVENT, { detail: status }))
}

export function getPerformanceIngestionStatus(): PerformanceIngestionStatus | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(INGESTION_STATUS_KEY)
    return value ? JSON.parse(value) as PerformanceIngestionStatus : null
  } catch { return null }
}

export function subscribePerformanceIngestionStatus(listener: (status: PerformanceIngestionStatus) => void) {
  if (typeof window === 'undefined') return () => undefined
  const handleStatus = (event: Event) => listener((event as CustomEvent<PerformanceIngestionStatus>).detail)
  window.addEventListener(INGESTION_STATUS_EVENT, handleStatus)
  return () => window.removeEventListener(INGESTION_STATUS_EVENT, handleStatus)
}

export function setWritePerformanceReporter(reporter: PerformanceReporter) {
  performanceReporter = reporter
}

const STORAGE_KEY = 'khataerp:write-performance'

export function performanceCompanySizeBand(companySize: number): PersistedWritePerformanceSample['company_size_band'] {
  return companySize < 1000 ? 'under_1k' : companySize < 10000 ? '1k_10k' : companySize < 50000 ? '10k_50k' : companySize <= 100000 ? '50k_100k' : 'over_100k'
}

function writeTracingEnabled() {
  if (import.meta.env.VITE_WRITE_PERF === 'true') return true
  if (!import.meta.env.DEV) return false
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
  private readonly consoleEnabled: boolean
  readonly traceId: string
  private readonly startedAt: number
  private queryCount = 0
  private finished = false
  private readonly sampled = Math.random() < 0.1
  private readonly stages: PersistedWritePerformanceSample['stages'] = []

  constructor(readonly context: WriteTraceContext) {
    this.consoleEnabled = writeTracingEnabled()
    this.enabled = this.consoleEnabled || !!performanceReporter
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

  recordStage(stage: string, durationMs: number, options: WriteStageOptions = {}) {
    if (!this.enabled || !Number.isFinite(durationMs) || durationMs < 0) return
    this.emit(stage, durationMs, true, options)
  }

  finish(success = true, error?: unknown) {
    if (this.finished) return
    this.finished = true
    const durationMs = Number((timestamp() - this.startedAt).toFixed(2))
    const totalSample: WritePerformanceSample = {
      ...this.context,
      traceId: this.traceId,
      stage: 'total',
      category: 'total',
      durationMs,
      success,
      queryCount: this.queryCount,
      errorName: error instanceof Error ? error.name : undefined,
    }
    if (this.consoleEnabled) report(totalSample)
    // Always retain invoice timings: these are the most consequential and
    // historically variable writes. Other fast operations remain sampled,
    // while every slow or failed operation is retained.
    const alwaysMeasure = /(?:sales|purchase)/i.test(this.context.operation) || /(?:sales|purchase)/i.test(this.context.recordType)
    if (performanceReporter && (alwaysMeasure || this.sampled || !success || durationMs >= 1000)) {
      const companySize = this.context.companySize || 0
      const connection = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: { effectiveType?: string } }).connection
      const errorCode = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : error instanceof Error ? error.name : undefined
      void Promise.resolve(performanceReporter({
        trace_id: this.traceId,
        company_id: this.context.companyId,
        operation: this.context.operation,
        record_type: this.context.recordType,
        duration_ms: durationMs,
        success,
        line_items: this.context.lineItems || 0,
        query_count: this.queryCount,
        network_class: connection?.effectiveType,
        company_size_band: performanceCompanySizeBand(companySize),
        app_version: import.meta.env.VITE_APP_VERSION || 'development',
        error_code: errorCode,
        stages: this.stages,
      })).then(() => updateIngestionStatus({ state: 'success', checked_at: new Date().toISOString() }))
        .catch((reportError: unknown) => {
          const errorCode = reportError && typeof reportError === 'object' && 'code' in reportError
            ? String((reportError as { code?: unknown }).code || 'unknown')
            : 'unknown'
          updateIngestionStatus({ state: 'error', checked_at: new Date().toISOString(), error_code: errorCode })
          // Reporting remains non-blocking and cannot turn a successful
          // accounting write into an apparent failure.
          if (this.consoleEnabled) console.warn('[KhataERP performance ingestion failed]', { error_code: errorCode })
        })
    }
  }

  private emit(stage: string, duration: number, success: boolean, options: WriteStageOptions, error?: unknown) {
    if (options.query) this.queryCount += 1
    const sample = {
      ...this.context,
      traceId: this.traceId,
      stage,
      category: options.category || 'frontend',
      durationMs: Number(duration.toFixed(2)),
      success,
      queryCount: this.queryCount,
      dbFunction: options.dbFunction,
      errorName: error instanceof Error ? error.name : undefined,
    }
    this.stages.push({ stage, category: options.category || 'frontend', duration_ms: Number(duration.toFixed(2)), success })
    if (this.consoleEnabled) report(sample)
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
