// Peticiones HTTP con timeout y reintentos con backoff exponencial y jitter.

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchOptions {
  userAgent: string;
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  headers?: Record<string, string>;
}

/** Espera exponencial con jitter "completo": aleatorio entre 0 y base·2^intento (con tope). */
export function backoffDelay(attempt: number, baseMs: number, capMs = 30 * 60_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url: string, opts: FetchOptions): Promise<Response> {
  const retries = opts.retries ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": opts.userAgent, ...opts.headers },
        redirect: "follow",
      });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new HttpError(`HTTP ${res.status} en ${new URL(url).host}`, res.status, retryable);
      if (!retryable) throw lastError;
      // Respeta Retry-After si el servidor lo indica.
      const retryAfter = Number(res.headers.get("retry-after"));
      if (attempt <= retries) {
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffDelay(attempt, opts.baseDelayMs ?? 2000));
      }
    } catch (err) {
      if (err instanceof HttpError && !err.retryable) throw err;
      lastError = err instanceof HttpError ? err : new HttpError(`Error de red en ${new URL(url).host}: ${(err as Error).message}`, null, true);
      if (attempt <= retries) await sleep(backoffDelay(attempt, opts.baseDelayMs ?? 2000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
