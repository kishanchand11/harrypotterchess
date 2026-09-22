/**
 * Token-bucket rate limiter + typed multi-listener event bus.
 */

/** Shared token bucket; capacity in events, refill per minute. */
export class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(private capacityPerMinute: number, burst?: number) {
    this.tokens = burst ?? capacityPerMinute;
  }

  /** Resolves when a token is available (await before each provider call). */
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const elapsedMin = (now - this.lastRefill) / 60_000;
      this.tokens = Math.min(this.capacityPerMinute, this.tokens + elapsedMin * this.capacityPerMinute);
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.capacityPerMinute) * 60_000);
      await sleep(Math.min(waitMs, 5_000));
    }
  }

  tryTake(): boolean {
    const now = Date.now();
    const elapsedMin = (now - this.lastRefill) / 60_000;
    this.tokens = Math.min(this.capacityPerMinute, this.tokens + elapsedMin * this.capacityPerMinute);
    this.lastRefill = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Bus<E extends Record<string, unknown>> {
  private listeners = new Set<(event: { type: keyof E & string; data: unknown }) => void>();

  subscribe(fn: (event: { type: keyof E & string; data: unknown }) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit<K extends keyof E & string>(type: K, data: E[K]): void {
    for (const fn of this.listeners) {
      try {
        fn({ type, data });
      } catch {
        /* listener isolated */
      }
    }
  }

  get count(): number {
    return this.listeners.size;
  }
}
