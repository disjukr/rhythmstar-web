/** The 24-byte sequence records built by native 0x11d940, expressed as values. */
export type SequenceEvent = {
  channel: number;
  value: number;
  holdIndex: number;
  speed: number;
  holdSpeed: number;
  timeMs: number;
  spawnMs: number;
};

export type ChartSequence = { bpm: number; speedScale: number; audioStartMs: number; events: SequenceEvent[] };

// 0x11d8f8. MUS channel numbers are decimal, including the discontinuity at 18.
const laneChannel = (channel: number): number | undefined => {
  if (channel >= 11 && channel <= 15) return channel - 11;
  if (channel >= 18 && channel <= 19) return channel - 13;
  if (channel >= 21 && channel <= 22) return channel - 14;
  if (channel >= 51 && channel <= 55) return channel - 41;
  if (channel >= 58 && channel <= 59) return channel - 43;
  if (channel >= 61 && channel <= 62) return channel - 44;
  if (channel === 16) return 20;
};

/** Preserve integer division, hold ticks and the original exchange-sort ordering. */
export const compileSequence = (text: string, scrollScale = 65536, speedScale = 65536): ChartSequence => {
  let bpm = 120;
  let audioStartMs = 0;
  let measureTime = Math.trunc(240_000 * 65536 / bpm);
  let previousMeasure = -1;
  const events: SequenceEvent[] = [];
  const holds = new Map<number, SequenceEvent>();
  const add = (channel: number, value: number, timeMs: number, holdIndex = 0): SequenceEvent => {
    const speed = Math.floor(Math.trunc(scrollScale * 120 * bpm / 120) * speedScale / 65536);
    const lead = (Math.imul(Math.trunc(250 * 4294967296 / speed), 1000) >> 16);
    const event = { channel, value, holdIndex, speed, holdSpeed: channel >= 10 && channel < 20 && speedScale > 65536 ? speedScale : 0, timeMs, spawnMs: timeMs - lead };
    events.push(event);
    return event;
  };
  for (const source of text.split(/[\r\n]+/)) {
    const line = source.trim();
    const header = line.match(/^#(BPM|MMF_START)\s+(-?\d+)/);
    if (header) {
      if (header[1] === "BPM") { bpm = Number(header[2]); measureTime = Math.trunc(240_000 * 65536 / bpm); }
      else audioStartMs = Number(header[2]);
      continue;
    }
    const match = line.match(/^#(\d{3})(\d{2}):\s*(\S+)/);
    if (!match) continue;
    const measure = Number(match[1]);
    if (measure !== previousMeasure) {
      add(21, 0, Math.floor(measure * measureTime / 65536));
      previousMeasure = measure;
    }
    const channel = laneChannel(Number(match[2]));
    if (channel === undefined) continue;
    const data = match[3];
    for (let offset = 0;offset < data.length;offset += 2) {
      const value = Number.parseInt(data.slice(offset, offset + 2), 10);
      if (!(value > 0)) continue;
      const time = Math.floor((measure * measureTime + Math.trunc(offset * measureTime / data.length)) / 65536);
      const event = add(channel, value, time);
      if (channel < 10 || channel >= 20) continue;
      const start = holds.get(channel);
      if (!start) { holds.set(channel, event); continue; }
      const interval = Math.floor(Math.trunc(measureTime / 64) / 65536);
      for (let timeMs = start.timeMs + interval, index = 1;timeMs < event.timeMs;timeMs += interval, index++) {
        const tick = add(channel, start.value, timeMs, index);
        tick.speed = start.speed;
        tick.spawnMs = timeMs - (Math.imul(Math.trunc(250 * 4294967296 / tick.speed), 1000) >> 16);
      }
      event.holdIndex = -1;
      holds.delete(channel);
    }
  }
  for (let i = 0;i < events.length;i++) {
    for (let j = 0;j < i;j++) {
      if (events[i].timeMs < events[j].timeMs) [events[i], events[j]] = [events[j], events[i]];
    }
  }
  return { bpm, speedScale, audioStartMs, events };
};
