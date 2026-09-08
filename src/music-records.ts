import { RhythmChart } from "./chart";
import { GameScoring } from "./game-scoring";
import { SaveData } from "./save-data";

/** The count-prefixed 0x7c-byte records in native musicdata.dat. */
export class MusicRecords {
  readonly bytes: Uint8Array;
  readonly #records = new Map<string, DataView>();
  constructor(charts: readonly RhythmChart[], read: (path: string) => Uint8Array, saved?: Uint8Array) {
    this.bytes = new Uint8Array(4 + charts.length * 0x7c);
    new DataView(this.bytes.buffer).setInt32(0, charts.length, true);
    for (const [index, chart] of charts.entries()) {
      const offset = 4 + index * 0x7c;
      const bytes = this.bytes.subarray(offset, offset + 0x7c);
      bytes.set(new TextEncoder().encode(chart.id).subarray(0, 31));
      const source = read(chart.id);
      const text = new TextDecoder('latin1').decode(source.subarray(4, 4 + new DataView(source.buffer, source.byteOffset).getUint32(0, true)));
      const title = /^#TITLE\s+"?([^\r\n"]+)/im.exec(text);
      if (title) {
        const start = title.index + title[0].indexOf(title[1]);
        bytes.set(source.subarray(4 + start, 4 + start + Math.min(31, title[1].length)), 0x40);
      }
      bytes[0x60] = chart.keyCount; bytes[0x61] = chart.level;
      const view = new DataView(this.bytes.buffer, offset, 0x7c);
      for (let i = 0x64;i <= 0x6c;i += 2) view.setInt16(i, 6, true);
      this.#records.set(chart.id, view);
    }
    if (saved && saved.length >= 4) {
      const count = new DataView(saved.buffer, saved.byteOffset, saved.byteLength).getInt32(0, true);
      if (count >= 0 && saved.length === 4 + count * 0x7c) {
        for (let i = 0;i < count;i++) {
          const bytes = saved.subarray(4 + i * 0x7c, 4 + (i + 1) * 0x7c);
          const end = bytes.subarray(0, 32).indexOf(0);
          const path = new TextDecoder().decode(bytes.subarray(0, end < 0 ? 32 : end));
          const view = this.#records.get(path);
          if (view) new Uint8Array(view.buffer, view.byteOffset + 0x62, 0x1a).set(bytes.subarray(0x62));
        }
      }
    }
  }
  record(path: string): DataView { return this.#records.get(path)!; }
  score(path: string): number { return this.record(path).getInt32(0x70, true); }
  combo(path: string): number { return this.record(path).getInt16(0x62, true); }
  grade(path: string): number { return Math.min(...[0x64, 0x66, 0x68, 0x6a, 0x6c].map(offset => this.record(path).getInt16(offset, true))); }
  /** 0x114254, including its conditional grade-slot fallthrough. */
  complete(path: string, scoring: GameScoring, save: SaveData, mirror = false, random = false, speed = 65536): number {
    const record = this.record(path), rank = scoring.rank();
    record.setInt16(0x62, Math.max(this.combo(path), scoring.maxCombo), true);
    record.setInt32(0x70, Math.max(this.score(path), scoring.score), true);
    const improve = (offset: number) => {
      if (record.getInt16(offset, true) <= rank) return false;
      record.setInt16(offset, rank, true); return true;
    };
    if (!(mirror && improve(0x64)) && !(random && improve(0x66))) improve(0x68);
    if (!(speed <= 65535 && improve(0x6a)) && speed > 131072) improve(0x6c);
    record.setInt32(0x78, 1, true);
    const trophy = this.awardTrophy(save);
    const increment = (offset: number) => save.view.setInt32(offset, save.view.getInt32(offset, true) + 1, true);
    increment(0x2d0); increment(0x2cc);
    save.view.setInt32(0x2e4, [...this.#records.values()].reduce((sum, value) => sum + value.getInt32(0x70, true), 0), true);
    increment(0x2e8 + rank * 4);
    const total = scoring.counts.reduce((sum, n) => sum + n, 0);
    const ratio = total ? Math.trunc(scoring.maxCombo * 100 / total) : 0;
    increment(0x308 + (ratio >= 100 ? 0 : ratio >= 90 ? 1 : ratio >= 80 ? 2 : ratio >= 70 ? 3 : ratio >= 60 ? 4 : 5) * 4);
    return trophy;
  }
  /** 0x113e04 updates awards in order and returns after the first increase. */
  awardTrophy(save: SaveData): number {
    const records = [...this.#records.entries()];
    const counts = (offset: number) => records.filter(([, record]) => record.getInt16(offset, true) <= 1).length;
    const gradeCount = (grade: number) => records.filter(([path]) => this.grade(path) === grade).length;
    const candidates: [number, number][] = [
      [0, Math.min(12, Number(save.view.getBigInt64(0x2c4, true) / 18000000n))],
      [1, Math.min(12, Math.trunc(save.view.getInt32(0x230, true) / 5000))],
      [2, Math.min(12, Math.trunc(save.view.getInt32(0x22c, true) / 500))],
      [3, Math.min(99, Math.trunc(gradeCount(1) / 5))],
      [4, Math.min(99, Math.trunc(gradeCount(0) / 5))],
      [5, records.every(([path]) => this.grade(path) === 0) ? 1 : save.view.getInt32(0x2a0, true)],
      [6, Math.min(99, Math.trunc(counts(0x64) / 5))],
      [7, Math.min(99, Math.trunc(counts(0x66) / 5))],
      [8, Math.min(99, Math.trunc(counts(0x6a) / 5))],
      [9, Math.min(99, Math.trunc(counts(0x6c) / 5))],
      [11, 0],
      [10, Array.from({ length: 11 }, (_, i) => save.view.getInt32(0x260 + i * 4, true)).every(Boolean) ? 1 : save.view.getInt32(0x2b4, true)],
    ];
    for (const [index, count] of candidates) {
      const offset = 0x28c + index * 4, previous = save.view.getInt32(offset, true);
      save.view.setInt32(offset, count, true);
      if (count > previous) return index;
    }
    return -1;
  }
}
