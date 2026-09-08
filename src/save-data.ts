/** savedata.dat, allocated by 0x115688 and written by 0x11596c. */
export class SaveData {
  readonly bytes: Uint8Array;
  readonly view: DataView;

  constructor(saved: Uint8Array | undefined, defaults: { sync: number; delay: number; vibrationValue: number; vibrationEnabled: boolean; model: string }) {
    this.bytes = new Uint8Array(0x334);
    this.view = new DataView(this.bytes.buffer);
    if (saved?.length === this.bytes.length) {
      this.bytes.set(saved);
    } else {
      this.volume = 3;
      this.vibrationEnabled = defaults.vibrationEnabled;
      this.view.setInt16(6, defaults.vibrationValue, true);
      this.sync = defaults.sync;
      this.delay = defaults.delay;
      this.view.setInt32(0x224, -1, true);
      this.bytes.set(new TextEncoder().encode(defaults.model).subarray(0, 19), 0x210);
    }
  }

  get volume(): number { return this.view.getInt32(0, true); }
  set volume(value: number) { this.view.setInt32(0, value, true); }
  get vibrationEnabled(): boolean { return this.view.getInt16(4, true) !== 0; }
  set vibrationEnabled(value: boolean) { this.view.setInt16(4, Number(value), true); }
  get sync(): number { return this.view.getInt32(8, true); }
  set sync(value: number) { this.view.setInt32(8, value, true); }
  get delay(): number { return this.view.getInt32(12, true); }
  set delay(value: number) { this.view.setInt32(12, value, true); }
}

// Native volume conversion at 0x115fd0, in percent.
export const SOUND_LEVELS = [0, 0.15, 0.3, 0.5, 0.75, 1] as const;
