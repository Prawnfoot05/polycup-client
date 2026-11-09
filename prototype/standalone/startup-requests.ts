// Only used for idempotent startup reads, before any native session exists.
export async function startupRequest<T = string>(
  url: string,
  options: { json?: boolean; timeoutMs?: number; attempts?: number } = {},
): Promise<T> {
  const total = options.attempts ?? 3;
  for (let attempt = 1; attempt <= total; attempt++) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), options.timeoutMs ?? 25000);
    let retryable = true;
    try {
      if (attempt > 1) (window as any).polycupBoot?.retry(attempt, total);
      const r = await fetch(url, {
        signal: abort.signal,
        cache: options.json ? 'no-store' : attempt > 1 ? 'reload' : 'default',
      });
      if (!r.ok) {
        retryable = [408, 425, 429].includes(r.status) || r.status >= 500;
        throw Error('Startup resource unavailable (' + r.status + ')');
      }
      // The timeout also covers a stalled response body, not just the headers.
      return (options.json ? await r.json() : await r.text()) as T;
    } catch (error) {
      if (!retryable || attempt === total) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 700));
  }
  throw Error('Startup resource unavailable');
}
