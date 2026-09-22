/** Fixed-capacity ring buffer — O(1) push, zero allocation after warmup. */
export class Ring<T> {
  private buf: (T | undefined)[];
  private head = 0; // next write index
  private _size = 0;

  constructor(readonly capacity: number) {
    this.buf = new Array(capacity);
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  get size(): number {
    return this._size;
  }

  /** Oldest → newest. */
  toArray(): T[] {
    const out: T[] = new Array(this._size);
    const start = (this.head - this._size + this.capacity) % this.capacity;
    for (let i = 0; i < this._size; i++) out[i] = this.buf[(start + i) % this.capacity] as T;
    return out;
  }

  /** Iterate oldest → newest without allocating. */
  forEach(fn: (item: T, i: number) => void): void {
    const start = (this.head - this._size + this.capacity) % this.capacity;
    for (let i = 0; i < this._size; i++) fn(this.buf[(start + i) % this.capacity] as T, i);
  }

  last(n = 1): T[] {
    const cnt = Math.min(n, this._size);
    const out: T[] = new Array(cnt);
    for (let i = 0; i < cnt; i++) {
      out[cnt - 1 - i] = this.buf[(this.head - 1 - i + this.capacity * 2) % this.capacity] as T;
    }
    return out;
  }

  clear(): void {
    this.buf = new Array(this.capacity);
    this.head = 0;
    this._size = 0;
  }
}
