import { ChartSequence, SequenceEvent } from "./chart-sequence";
import { GameScoring, HitGrade, judgeTiming } from "./game-scoring";

export type PlayingNote = {
  event: SequenceEvent | undefined;
  state: number;
  nextState: number;
  counter: number;
  free: boolean;
  elapsed: number;
  y: number;
  bonus: number;
};

/** Native game state 6/7 and the 256 objects updated by 0x111c64. */
export class GameplayEngine {
  readonly feedback: ({ kind: "hit"; channel: number; grade: HitGrade; holdIndex: number; combo: number; previousCombo: number } | { kind: "miss" } | { kind: "bonus"; channel: number; value: number })[] = [];
  readonly scoring: GameScoring;
  readonly notes: PlayingNote[] = Array.from({ length: 256 }, () => ({ event: undefined, state: 0, nextState: 0, counter: 0, free: true, elapsed: 0, y: 320 * 65536, bonus: 0 }));
  phase: "ready" | "playing" | "paused" | "failed" | "complete" = "ready";
  startedAt: number | undefined;
  cursor = 0;
  heldMask = 0;
  holdStartedMask = 0;
  #poolCursor = 0;
  #prepared = false;
  constructor(readonly sequence: ChartSequence, readonly mode: number, readonly random: () => number, planetMultiplier = 65536, readonly sync = 0, readonly delay = 0, readonly mirror = false, readonly randomLanes = false) {
    this.scoring = new GameScoring(mode, planetMultiplier);
  }
  #request(note: PlayingNote, state: number): void { note.nextState = state; note.counter = 0; }
  #spawn(event: SequenceEvent, time: number): void {
    if (event.channel < 10) {
      let channel = this.mirror ? 2 + this.mode * 3 - event.channel : event.channel;
      if (this.randomLanes) channel = Math.floor(channel / 3) * 3 + this.random() % 3;
      event = { ...event, channel: Math.max(0, Math.min(2 + this.mode * 3, channel)) };
    }
    let slot = this.#poolCursor;
    while (slot < 256 && !this.notes[slot].free) slot++;
    if (slot === 256) { slot = 0; while (slot < this.#poolCursor && !this.notes[slot].free) slot++; if (slot === this.#poolCursor) return; }
    this.#poolCursor = slot;
    const note = this.notes[slot];
    note.event = event;
    note.elapsed = time - event.spawnMs;
    note.y = 320 * 65536;
    note.free = false;
    note.bonus = 0;
    if (event.channel < 10) {
      if (this.random() % 5000 <= 9) note.bonus = 1;
      else if (this.random() % 50000 <= 9) note.bonus = 10;
    }
    this.#request(note, 1);
  }
  #hit(note: PlayingNote, grade: HitGrade): void {
    const event = note.event!;
    const hold = event.channel >= 10;
    const previousCombo = this.scoring.combo;
    this.scoring.hit(grade, !hold || event.holdIndex % 10 === 0);
    this.feedback.push({ kind: "hit", channel: event.channel, grade, holdIndex: event.holdIndex, combo: this.scoring.combo, previousCombo });
    this.#request(note, hold ? 2 : 5);
  }
  #judge(pressed: number): number {
    if (!pressed && !this.heldMask) return 0;
    let consumed = 0;
    let lastGrade = 0;
    for (const note of this.notes) {
      const event = note.event;
      if (note.free || note.state === 2 || note.state === 5 || !event || event.channel > 19) continue;
      const hold = event.channel >= 10;
      const bit = 1 << (event.channel - (hold ? 10 : 0));
      if (consumed & bit || !((hold ? this.heldMask : pressed) & bit)) continue;
      if (!hold || event.holdIndex === 0) {
        lastGrade = judgeTiming(note.elapsed - (event.timeMs - event.spawnMs));
        if (!lastGrade) continue;
        if (hold) this.holdStartedMask |= bit;
      }
      if (!lastGrade) continue;
      this.#hit(note, lastGrade as HitGrade);
      consumed |= bit;
    }
    return lastGrade;
  }
  update(now: number, delta: number, pressedMask: number, heldMask: number, beforeSpawn: () => void = () => { }): void {
    this.feedback.length = 0;
    if (!this.#prepared) { this.#prepared = true; return; }
    if (this.phase === "ready") { this.phase = "playing"; this.startedAt = now; }
    const playingAtStart = this.phase === "playing";
    if (this.phase === "playing") {
      beforeSpawn();
      const time = now - this.startedAt! + this.delay;
      const correction = Math.floor(time / 256) * this.sync;
      while (this.cursor < this.sequence.events.length && time > this.sequence.events[this.cursor].spawnMs + correction) {
        const source = this.sequence.events[this.cursor++];
        this.#spawn({ ...source, timeMs: source.timeMs + correction, spawnMs: source.spawnMs + correction }, time);
      }
      this.holdStartedMask &= heldMask;
      this.heldMask = heldMask;
      this.#judge(pressedMask);
    }
    for (const note of this.notes) {
      note.counter++;
      note.state = note.nextState;
      const event = note.event;
      if (note.state === 2 && note.counter === 1) note.free = true;
      else if (note.state === 5) {
        if (note.counter === 1 && note.bonus && event) this.feedback.push({ kind: "bonus", channel: event.channel, value: note.bonus });
        this.#request(note, 2);
      }
      else if (note.state === 1 && event) {
        if (!playingAtStart) this.#request(note, 2);
        if (note.counter !== 1) note.elapsed += delta;
        note.y = 320 * 65536 - Math.trunc(event.speed * note.elapsed / 1000);
        const due = event.timeMs - event.spawnMs;
        if (event.channel >= 20) {
          if (note.elapsed > due) {
            this.#request(note, 2);
            if (event.channel === 20) { this.phase = "complete"; this.scoring.multiplier = 65536; }
          }
        } else if (note.elapsed > due + 200) {
          const hold = event.channel >= 10;
          // The native miss path offers pending held keys one final judgement pass.
          const rescued = hold && this.#judge(pressedMask) !== 0;
          if (!rescued) { this.scoring.miss(hold ? event.holdIndex : undefined); this.feedback.push({ kind: "miss" }); }
          this.#request(note, 2);
          if (this.scoring.gauge <= 0) this.phase = "failed";
        } else if (event.channel >= 10 && note.elapsed > due) {
          const bit = 1 << (event.channel - 10);
          if (this.heldMask & this.holdStartedMask & bit) this.#hit(note, 4);
        }
      }
    }
  }
}
