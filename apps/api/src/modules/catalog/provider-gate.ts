export class ProviderUnavailableError extends Error {
  constructor(provider: string) {
    super(`${provider} is temporarily unavailable (circuit open)`);
  }
}

export interface GateOptions {
  name: string;
  /** Minimum gap between call starts (the plan asks for 1 request/second per provider). */
  minIntervalMs: number;
  failureThreshold?: number;
  openMs?: number;
}

/** Per-provider rate limit + circuit breaker (open for 60 s after 5 consecutive failures). */
export class ProviderGate {
  private chain: Promise<unknown> = Promise.resolve();
  private lastStart = 0;
  private failures = 0;
  private openUntil = 0;

  constructor(private readonly opts: GateOptions) {}

  get isOpen(): boolean {
    return this.openUntil > Date.now();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen) throw new ProviderUnavailableError(this.opts.name);
    const turn = this.chain.then(async () => {
      const wait = this.lastStart + this.opts.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastStart = Date.now();
    });
    this.chain = turn.catch(() => {});
    await turn;
    if (this.isOpen) throw new ProviderUnavailableError(this.opts.name);
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (e) {
      if (++this.failures >= (this.opts.failureThreshold ?? 5)) {
        this.openUntil = Date.now() + (this.opts.openMs ?? 60_000);
        this.failures = 0;
      }
      throw e;
    }
  }
}

/** GET JSON with a timeout. 404 → null; other non-2xx → throws (counts toward the circuit breaker). */
export async function fetchJson<T>(url: string, opts: { timeoutMs: number; headers?: Record<string, string> }): Promise<T | null> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...opts.headers },
    signal: AbortSignal.timeout(opts.timeoutMs),
    redirect: 'follow',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
}
