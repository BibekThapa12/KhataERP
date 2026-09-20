/** Read-only deadline. Never wrap posting requests: a timed-out write may have committed. */
export async function withReadDeadline<T>(
  stage: string,
  read: (signal: AbortSignal) => PromiseLike<T>,
  milliseconds = 45_000,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Company data read timed out: ${stage}. Retry loading; no records were changed.`))
      controller.abort()
    }, milliseconds)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => read(controller.signal)), timeout])
  } finally {
    clearTimeout(timer)
  }
}
