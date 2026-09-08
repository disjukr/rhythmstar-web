import type { GameKey } from './game';
import type { RhythmStarIo } from './io';
import { RhythmChart, parseMus } from './chart';
import { SaveData } from './save-data';
import { MusicRecords } from './music-records';
import { GameplayEngine } from './gameplay-engine';
import { GameplayView } from './gameplay-view';
import { GameOverScreen } from './gameover-screen';
import { PauseScreen } from './pause-screen';
import { ResultScreen } from './result-screen';
import { Rgb565Framebuffer } from './framebuffer';
import { PLANETS } from './planets';
import { HelpScreen } from './help-screen';

export class GameSession {
  engine!: GameplayEngine;
  view!: GameplayView;
  #result: ResultScreen | undefined;
  #pause: PauseScreen | undefined;
  #help: HelpScreen | undefined;
  #gameOver: GameOverScreen | undefined;
  #pending: 'result' | 'pause' | 'retry' | undefined;
  #failedTicks = 0;
  #trophy = -1;
  #vibrationTime = 0;
  #audioStarted = false;
  #prepared = false;
  readonly #planet;
  constructor(readonly chart: RhythmChart, readonly mode: number, readonly save: SaveData, readonly records: MusicRecords, readonly io: RhythmStarIo, readonly read: (path: string) => Uint8Array, readonly random: () => number) {
    this.#planet = PLANETS[save.view.getInt32(0x224, true)];
    this.#start();
  }
  #start(): void {
    const planet = this.#planet;
    const chart = parseMus(this.chart.id, this.read(this.chart.id), planet?.speed);
    this.engine = new GameplayEngine(chart.sequence, this.mode, this.random, planet?.multiplier, this.save.sync, this.save.delay, planet?.mirror, planet?.random);
    this.view = new GameplayView(this.engine, this.read, () => {
      if (!this.save.vibrationEnabled) return;
      const milliseconds = this.#vibrationTime > 0 ? 0 : 100;
      this.#vibrationTime = milliseconds ? 120 : 0;
      this.io.vibration.pulse(milliseconds);
      this.io.trace.record('vibration.pulse', { milliseconds });
    });
    this.#pause = undefined; this.#result = undefined; this.#gameOver = undefined;
    this.#failedTicks = 0; this.#audioStarted = false; this.#prepared = false;
    this.io.music.stop();
    this.io.trace.record('state.enter', { state: 22, phase: 'playing', chart: this.chart.id });
  }
  #save(): void {
    this.io.storage.write('savedata.dat', this.save.bytes);
    this.io.trace.record('storage.write', { name: 'savedata.dat', size: this.save.bytes.length });
  }
  #increment(offset: number, amount = 1): void { this.save.view.setInt32(offset, this.save.view.getInt32(offset, true) + amount, true); }
  update(now: number, delta: number, keys: ReadonlySet<GameKey>, held: ReadonlySet<GameKey>): 'songSelect' | 'restart' | undefined {
    this.#vibrationTime -= delta;
    if (this.#pending === 'retry') this.#start();
    else if (this.#pending === 'pause') {
      this.#pause = new PauseScreen(this.save, this.io, this.read);
      this.io.music.stop(); this.io.trace.record('state.enter', { state: 36, phase: 'pause' });
      this.view.advanceStopped(0, true);
      this.engine.phase = "paused";
      this.engine.heldMask = 0;
    } else if (this.#pending === 'result') {
      this.#result = new ResultScreen(this.chart, this.engine.scoring, this.io, this.read, this.#trophy);
      this.io.trace.record('state.enter', { state: 23, phase: 'result' });
    }
    this.#pending = undefined;
    if (this.#result) {
      if (this.#result.update(delta, keys)) {
        this.io.storage.write('musicdata.dat', this.records.bytes); this.#save(); return 'songSelect';
      }
      return;
    }
    if (this.#pause) {
      this.view.advanceStopped(delta);
      this.engine.update(now, delta, 0, 0);
      this.view.afterUpdate();
      if (this.#help) {
        if (this.#help.update(delta, keys)) this.#help = undefined;
        return;
      }
      const next = this.#pause.update(delta, keys);
      if (next === 'playing') this.#pending = 'retry';
      else if (next === 'report') this.#help = new HelpScreen(this.read);
      else if (next === 'songSelect' || next === 'restart') return next;
      return;
    }
    if (this.engine.phase === 'failed') {
      if (this.#gameOver?.ready && keys.size) return 'songSelect';
      this.#failedTicks++;
      this.view.advanceStopped(delta, this.#failedTicks === 5);
      if (this.#failedTicks === 1) {
        this.io.music.stop(); this.#increment(0x2cc);
        this.save.view.setInt32(0x2d4, this.save.view.getInt32(0x2cc, true) - this.save.view.getInt32(0x2d0, true), true); this.#save();
      }
      if (this.#failedTicks === 5) {
        this.#gameOver = new GameOverScreen(this.view.archive);
        const resource = 'res/Mmf/EffectGameOver.mmf';
        this.io.music.playEffect(this.read(resource)); this.io.trace.record('sound.play', { resource });
      }
    }
    const mask = (set: ReadonlySet<GameKey>) => Array.from({ length: 3 + this.mode * 3 }, (_, lane) => set.has(String(lane + 1) as GameKey) ? 1 << lane : 0).reduce((a, b) => a | b, 0);
    const pressed = mask(keys);
    const wasPrepared = this.#prepared;
    this.#prepared = true;
    this.engine.update(now, delta, pressed, mask(held), () => this.view.beforeSpawn(delta));
    this.view.afterUpdate(wasPrepared ? pressed : 0);
    this.#gameOver?.update(delta);
    if (!this.#audioStarted && (Math.abs(this.save.delay) !== 600 || this.engine.startedAt !== undefined && now > this.engine.startedAt + this.engine.sequence.audioStartMs)) {
      this.#audioStarted = true;
      const resource = `res/Mmf/${this.chart.audioFilename}`;
      this.io.music.play(this.read(resource), false); this.io.trace.record('music.play', { resource, repeat: false });
    }
    for (const event of this.engine.feedback) {
      if (event.kind === 'hit' && event.grade === 1) {
        this.#increment(0x230, event.previousCombo);
        this.save.view.setInt32(0x304, this.save.view.getInt32(0x230, true), true);
      }
      if (event.kind === 'bonus') {
        this.#increment(0x228, event.value); this.#increment(0x22c, event.value); this.#increment(event.value === 10 ? 0x328 : 0x324);
        this.save.view.setInt32(0x320, this.save.view.getInt32(0x22c, true), true);
        this.save.view.setInt32(0x228, Math.min(9999, this.save.view.getInt32(0x228, true)), true);
      }
    }
    if (this.engine.phase === 'complete') {
      this.#trophy = this.records.complete(this.chart.id, this.engine.scoring, this.save, this.#planet?.mirror, this.#planet?.random, this.#planet?.speed);
      this.#pending = 'result';
    } else if (this.engine.phase === 'playing' && keys.has('back')) this.#pending = 'pause';
  }
  draw(target: Rgb565Framebuffer): void {
    if (this.#result) this.#result.draw(target);
    else { this.view.draw(target); this.#gameOver?.draw(target); if (this.#help) this.#help.draw(target); else this.#pause?.draw(target); }
  }
}
