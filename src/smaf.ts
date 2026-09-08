// Mobile Standard (uncompressed) SMAF, the format used by the original BGM.
// Durations and gates have separate millisecond timebases; 0x8n is a note
// reusing the channel's previous velocity, not a MIDI note-off.
export type SmafEvent = { time: number; data: number[] };
export type SmafWave = { time: number; samplingRate: number; samples: Int16Array };
export type SmafSequence = { duration: number; events: SmafEvent[]; waves?: SmafWave[] };

// Yamaha ADPCM-B: high nibble first, predictor and step saturate separately.
export function decodeYamahaAdpcm(bytes: Uint8Array): Int16Array {
  const scales = [57, 57, 57, 57, 77, 102, 128, 153];
  const samples = new Int16Array(bytes.length * 2);
  let predictor = 0;
  let step = 127;
  let index = 0;
  for (const byte of bytes) {
    for (const nibble of [byte >>> 4, byte & 15]) {
      const delta = ((1 + 2 * (nibble & 7)) * step) >> 3;
      predictor = Math.max(-32768, Math.min(32767, predictor + (nibble & 8 ? -delta : delta)));
      step = Math.max(127, Math.min(24576, (step * scales[nibble & 7]) >> 6));
      samples[index++] = predictor;
    }
  }
  return samples;
}

class Reader {
  position = 0;
  constructor(readonly bytes: Uint8Array) { }
  byte(): number {
    if (this.position >= this.bytes.length) throw new Error("Truncated SMAF data");
    return this.bytes[this.position++];
  }
  take(length: number): Uint8Array {
    if (this.position + length > this.bytes.length) throw new Error("Truncated SMAF chunk");
    const result = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return result;
  }
  variable(): number {
    let value = 0;
    for (let count = 0;count < 4;count++) {
      const byte = this.byte();
      value = value * 128 + (byte & 127);
      if (byte < 128) return value;
    }
    throw new Error("Invalid SMAF variable-length number");
  }
}

function* chunks(bytes: Uint8Array): Generator<{ tag: string; bytes: Uint8Array }> {
  const reader = new Reader(bytes);
  while (reader.position < bytes.length) {
    const tag = String.fromCharCode(...reader.take(4));
    const length = reader.byte() * 0x1000000 + reader.byte() * 0x10000 + reader.byte() * 0x100 + reader.byte();
    yield { tag, bytes: reader.take(length) };
  }
}

function timebase(value: number): number {
  const bases: Readonly<Record<number, number>> = { 0: 1, 1: 2, 2: 4, 3: 5, 16: 10, 17: 20, 18: 40, 19: 50 };
  const result = bases[value];
  if (result === undefined) throw new Error(`Unsupported SMAF timebase ${value}`);
  return result;
}

export function parseSmaf(bytes: Uint8Array): SmafSequence {
  const root = [...chunks(bytes)];
  if (root.length !== 1 || root[0].tag !== "MMMD") throw new Error("Invalid SMAF header");
  const events: SmafEvent[] = [];
  const waves: SmafWave[] = [];
  let duration = 0;
  let tracks = 0;
  // The MMMD payload ends with a two-byte CRC, not another chunk.
  for (const track of chunks(root[0].bytes.subarray(0, -2))) {
    if (!track.tag.startsWith("MTR")) continue;
    tracks++;
    const header = new Reader(track.bytes);
    const format = header.byte();
    if (format !== 2) throw new Error(`Unsupported SMAF score format ${format}`);
    if (header.byte() !== 0) throw new Error("Unsupported SMAF subsequence");
    const deltaBase = timebase(header.byte());
    const gateBase = timebase(header.byte());
    header.take(16); // Mobile channel status: LEDs/vibration are not audio.
    const trackChunks = [...chunks(track.bytes.subarray(header.position))];
    const waveData = new Map<number, Omit<SmafWave, "time">>();
    for (const chunk of trackChunks) {
      if (chunk.tag !== "Mtsp") continue;
      for (const wave of chunks(chunk.bytes)) {
        const reader = new Reader(wave.bytes);
        const format = reader.byte();
        if (!wave.tag.startsWith("Mwa") || (format !== 0x20 && format !== 0x11)) throw new Error(`Unsupported SMAF stream-wave format ${format}`);
        const samplingRate = reader.byte() * 256 + reader.byte();
        if (samplingRate === 0) throw new Error("Invalid SMAF sampling rate");
        const payload = wave.bytes.subarray(reader.position);
        const samples = format === 0x20 ? decodeYamahaAdpcm(payload) : Int16Array.from(payload, sample => (sample - 128) * 256);
        waveData.set(wave.tag.charCodeAt(3), { samplingRate, samples });
      }
    }
    for (const chunk of trackChunks) {
      // Mtsu contains Yamaha MA voice definitions. GM playback uses fallback
      // programs instead; these definitions must not be sent as GM SysEx.
      if (chunk.tag !== "Mtsq") continue;
      const reader = new Reader(chunk.bytes);
      const velocities = new Uint8Array(16).fill(64);
      let time = 0;
      let ended = false;
      while (reader.position < chunk.bytes.length) {
        time += reader.variable() * deltaBase;
        const status = reader.byte();
        const kind = status & 0xf0;
        const channel = status & 15;
        if (kind === 0x80 || kind === 0x90) {
          const note = reader.byte();
          if (kind === 0x90) velocities[channel] = reader.byte();
          const end = time + reader.variable() * gateBase;
          if (note === 0) {
            const wave = waveData.get(channel + 1);
            // MA sequences also contain zero-note messages on channels with
            // no stream wave. Like the native player, leave those silent.
            if (wave) waves.push({ time, ...wave });
          } else {
            events.push({ time, data: [0x90 | channel, note, velocities[channel]] });
            events.push({ time: end, data: [0x80 | channel, note, 0] });
          }
          duration = Math.max(duration, end);
        } else if (kind === 0xb0 || kind === 0xe0 || kind === 0xa0) {
          events.push({ time, data: [status, reader.byte(), reader.byte()] });
        } else if (kind === 0xc0 || kind === 0xd0) {
          events.push({ time, data: [status, reader.byte()] });
        } else if (status === 0xf0) {
          reader.take(reader.variable()); // Yamaha sequence/device commands.
        } else if (status === 0xff) {
          const type = reader.byte();
          if (type === 0x2f) {
            if (reader.byte() !== 0) throw new Error("Invalid SMAF end event");
            ended = true;
            break;
          }
          if (type !== 0) throw new Error(`Unsupported SMAF system event ${type}`);
        } else {
          throw new Error(`Unsupported SMAF status 0x${status.toString(16)}`);
        }
      }
      if (!ended) throw new Error("SMAF sequence has no end event");
      duration = Math.max(duration, time);
    }
  }
  if (tracks !== 1 || (events.length === 0 && waves.length === 0)) throw new Error("Expected one SMAF score track");
  // Keep setup/controller order, but release an old note before retriggering it.
  const priority = (event: SmafEvent): number => (event.data[0] & 0xf0) === 0x90 ? 2 : (event.data[0] & 0xf0) === 0x80 ? 1 : 0;
  events.sort((a, b) => a.time - b.time || priority(a) - priority(b));
  return waves.length ? { duration, events, waves } : { duration, events };
}

/** GM fallback only: retain the original score; replace Yamaha banks/voices. */
export function smafToMidi(sequence: SmafSequence): Uint8Array<ArrayBuffer> {
  if (sequence.waves?.length) throw new Error("SMAF stream waves require PCM playback");
  const drums = new Set<number>();
  for (const { data } of sequence.events) {
    if ((data[0] & 0xf0) === 0xb0 && data[1] === 0 && data[2] === 0x7d) drums.add(data[0] & 15);
  }
  const channels = new Map<number, number>();
  let nextChannel = 0;
  for (const { data } of sequence.events) {
    const channel = data[0] & 15;
    if (channels.has(channel)) continue;
    if (drums.has(channel)) channels.set(channel, 9);
    else {
      if (nextChannel === 9) nextChannel++;
      if (nextChannel > 15) throw new Error("Too many SMAF melody channels for GM");
      channels.set(channel, nextChannel++);
    }
  }
  const track: number[] = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20]; // 500,000 us / quarter.
  // Explicit full-file loop: the sequencer otherwise defaults to first note,
  // which would drop the original opening silence on subsequent repetitions.
  track.push(0, 0xff, 6, 9, ...new TextEncoder().encode("loopStart"));
  const variable = (value: number): number[] => {
    const bytes = [value & 127];
    while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 127) | 128);
    return bytes;
  };
  let previous = 0;
  for (const event of sequence.events) {
    const [status, first, second] = event.data;
    const kind = status & 0xf0;
    // MA bank numbers have no matching GM bank; default bank zero is used.
    if (kind === 0xb0 && (first === 0 || first === 32)) continue;
    const channel = channels.get(status & 15);
    if (channel === undefined) throw new Error("Unmapped SMAF channel");
    const data = kind === 0xc0 && drums.has(status & 15) ? [kind | channel, 0]
      : second === undefined ? [kind | channel, first] : [kind | channel, first, second];
    track.push(...variable(event.time - previous), ...data);
    previous = event.time;
  }
  track.push(...variable(sequence.duration - previous), 0xff, 6, 7, ...new TextEncoder().encode("loopEnd"));
  track.push(0, 0xff, 0x2f, 0);
  const length = track.length;
  // 500 ticks / quarter gives exactly 1 millisecond per tick.
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xf4,
    0x4d, 0x54, 0x72, 0x6b, length >>> 24, (length >>> 16) & 255, (length >>> 8) & 255, length & 255, ...track]);
}
