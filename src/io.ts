export type Effect = Readonly<{
  sequence: number;
  kind: string;
  detail: Readonly<Record<string, string | number | boolean | null>>;
}>;

export class EffectTrace {
  readonly #effects: Effect[] = [];

  record(kind: string, detail: Effect["detail"] = {}): void {
    this.#effects.push({ sequence: this.#effects.length + 1, kind, detail });
  }

  snapshot(): readonly Effect[] {
    return this.#effects.slice();
  }
}

export interface ResourcePort {
  read(path: string): Uint8Array;
}

export interface StoragePort {
  read(name: string): Uint8Array | undefined;
  write(name: string, data: Uint8Array): void;
}

export interface ClockPort {
  now(): number;
  every(milliseconds: number, callback: () => void): () => void;
}

export interface ScreenPort {
  present(width: number, height: number, rgb565: Uint16Array): void;
}

export interface BacklightPort {
  configure(enabled: boolean, color: number, timeoutMilliseconds: number): void;
}

export interface MusicPort {
  setVolume(level: number): void;
  play(data: Uint8Array, repeat: boolean): void;
  playEffect(data: Uint8Array): void;
  stop(): void;
}

export type RhythmStarIo = Readonly<{
  resources: ResourcePort;
  storage: StoragePort;
  clock: ClockPort;
  screen: ScreenPort;
  backlight: BacklightPort;
  music: MusicPort;
  vibration: { pulse(milliseconds: number): void };
  trace: EffectTrace;
}>;

export class ResourceStore implements ResourcePort {
  readonly #resources: Readonly<Record<string, Uint8Array>>;

  constructor(resources: Readonly<Record<string, Uint8Array>>) {
    this.#resources = Object.fromEntries(Object.entries(resources).map(([path, bytes]) => [ResourceStore.normalize(path), bytes]));
  }

  read(path: string): Uint8Array {
    const bytes = this.#resources[ResourceStore.normalize(path)];
    if (!bytes) throw new Error(`원본 리소스를 찾지 못했습니다: ${path}`);
    return bytes;
  }

  static normalize(path: string): string {
    return path.replaceAll("\\", "/").replace(/^\/+/, "");
  }
}
