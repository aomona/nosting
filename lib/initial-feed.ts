// Keep the first snapshot separate from history pagination. A silent relay must
// not prevent healthy relays from becoming usable indefinitely.
export class InitialFeed {
  private pending = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private changed: (loading: boolean) => void = () => {};
  get loading() { return this.pending.size > 0; }
  start(urls: string[], changed: (loading: boolean) => void, timeoutMs = 8000) {
    this.cancel();
    this.pending = new Set(urls);
    this.changed = changed;
    changed(this.loading);
    if (this.loading) this.timer = setTimeout(() => this.finish(), timeoutMs);
  }
  settle(url: string) {
    if (!this.pending.delete(url)) return;
    if (!this.loading) this.finish();
  }
  private finish() {
    this.pending.clear();
    clearTimeout(this.timer);
    this.timer = undefined;
    this.changed(false);
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
    this.changed = () => {};
  }
}
