/**
 * relay/limits.ts — sliding-window counters for relayed calls (#1238): one
 * bucket per account, one per account + client, so one noisy client can't
 * spend its account's whole allowance and no account can flood its desktop.
 * In memory, like the gateway's other limiters (one Render instance).
 */
export class SlidingWindow {
  private readonly hits = new Map<string, number[]>()
  private lastSweep = Date.now()

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  /** Count a hit for `key`: 0 when allowed, else the seconds until one is. */
  hit(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return Math.max(Math.ceil((recent[0] + this.windowMs - now) / 1000), 1)
    }
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > 5000 || now - this.lastSweep >= this.windowMs) {
      this.lastSweep = now
      for (const [k, ts] of this.hits) if (ts.every((t) => now - t >= this.windowMs)) this.hits.delete(k)
    }
    return 0
  }
}
