import { GameplayEngine } from "./gameplay-engine";
import { Rgb565Framebuffer } from "./framebuffer";
import { parseVrp, VrpPlayer, drawVrpFrameBottomUp } from "./vrp";

// 0x1127a4 selects these MainGame.vrp programs for 3/6/9 keys.
const PROGRAMS = [
  { hud: [37, 55, 56, 31, 65, 65, 54, 87], key: 61, bar: 57, label: 75, hold: 71, emptyLabel: 74, x: 63, width: 39 },
  { hud: [100, 118, 119, 94, 65, 134, 117, 165], key: 127, bar: 120, label: 150, hold: 143, emptyLabel: 149, x: 49, width: 24 },
  { hud: [178, 196, 197, 172, 65, 218, 195, 258], key: 208, bar: 198, label: 240, hold: 230, emptyLabel: 239, x: 49, width: 16 },
];

/** Drawing and player advancement from 0x1125c0, 0x113a44 and 0x111448. */
export class GameplayView {
  readonly archive;
  readonly hud: VrpPlayer[];
  readonly keys: VrpPlayer[];
  readonly background: VrpPlayer[];
  readonly notePlayers: { body: VrpPlayer; label: VrpPlayer }[];
  readonly #cues: { player: VrpPlayer; active: boolean }[];
  readonly #effects: { player: VrpPlayer; active: boolean; ending: boolean; free: boolean; x: number; y: number; holdLane: number; settle: boolean; remaining: number | undefined }[];
  readonly #combo: VrpPlayer;
  readonly #tier: VrpPlayer;
  #tierVisible = false;
  #tierIntro = false;
  #lastMultiplier = 1;
  #vibrationDelay = 0;
  #comboCount = 0;
  #comboVisible = false;
  #comboEnding = false;
  #effectCursor = 0;
  #backgroundDelay = 0;
  #delta = 50;
  constructor(readonly engine: GameplayEngine, read: (path: string) => Uint8Array, readonly vibrate: () => void = () => { }) {
    this.archive = parseVrp(read("res/Vrp/MainGame.vrp"));
    const program = PROGRAMS[engine.mode];
    this.hud = program.hud.map(id => new VrpPlayer(this.archive, id));
    const speed = engine.sequence.speedScale;
    this.hud[4].select(speed < 65536 ? 84 : speed > 131072 ? 86 : speed > 65536 ? 85 : 65);
    if (engine.mirror || engine.randomLanes) this.hud[5].select(engine.mirror ? 82 : 83);
    this.background = [4, 3, 2].map(offset => new VrpPlayer(this.archive, program.hud[3] + offset));
    for (const player of this.background) player.update(50);
    this.keys = Array.from({ length: 3 + engine.mode * 3 }, () => new VrpPlayer(this.archive, program.key));
    this.notePlayers = engine.notes.map(() => ({ body: new VrpPlayer(this.archive, 58), label: new VrpPlayer(this.archive, 75) }));
    this.#cues = this.keys.map((_, lane) => ({ player: new VrpPlayer(this.archive, [66, 135, 219][engine.mode] + lane, false), active: false }));
    this.#effects = Array.from({ length: 128 }, () => ({ player: new VrpPlayer(this.archive, 90, false), active: false, ending: false, free: true, x: 0, y: 0, holdLane: -1, settle: false, remaining: undefined }));
    this.#combo = new VrpPlayer(this.archive, [46, 109, 187][engine.mode], false);
    this.#tier = new VrpPlayer(this.archive, [38, 101, 179][engine.mode]);
  }
  beforeSpawn(delta: number): void {
    this.#delta = delta;
    for (const player of this.background) player.update(delta);
    this.#backgroundDelay -= delta;
    if (this.#backgroundDelay < 0 && this.hud[0].update(delta)) this.#backgroundDelay = 5000;
    this.hud[1].update(delta); this.hud[2].update(delta);
    if (this.hud[3].update(delta)) this.hud[3].select(PROGRAMS[this.engine.mode].hud[3] + (this.engine.random() & 1));
    const gauge = Math.max(0, Math.min(99, this.engine.scoring.gauge + this.engine.random() % 5 - 2));
    this.hud[6].frame = 99 - gauge;
    if (this.hud[7].update(delta)) this.hud[7].select(PROGRAMS[this.engine.mode].hud[7]);
    for (const player of this.keys) if (player.update(delta)) player.select(PROGRAMS[this.engine.mode].key);
  }
  advanceStopped(delta: number, clearCombo = false): void {
    this.#delta = delta;
    for (const player of this.background) player.update(delta);
    for (const effect of this.#effects) if (effect.holdLane >= 0) effect.ending = true;
    if (clearCombo) { this.#comboVisible = false; this.#tierVisible = false; }
  }
  #effect(animation: number, x = 0, y = 0, holdLane = -1, remaining?: number): void {
    let index = this.#effectCursor;
    while (index < 128 && !this.#effects[index].free) index++;
    if (index === 128) { index = 0; while (index < this.#effectCursor && !this.#effects[index].free) index++; if (index === this.#effectCursor) return; }
    this.#effectCursor = index;
    const effect = this.#effects[index];
    effect.player.select(animation, false);
    effect.active = true; effect.ending = false; effect.free = false; effect.x = x; effect.y = y;
    effect.remaining = remaining; effect.holdLane = holdLane; effect.settle = holdLane >= 0;
  }
  afterUpdate(pressed = 0): void {
    const p = PROGRAMS[this.engine.mode];
    if (this.#comboEnding) { this.#comboVisible = false; this.#comboEnding = false; }
    if (pressed) this.hud[7].select(p.hud[7] + 1);
    for (const [lane, cue] of this.#cues.entries()) {
      if ((pressed | this.engine.heldMask) & (1 << lane)) {
        this.keys[lane].select(p.key + 1 + lane);
        cue.player.select([66, 135, 219][this.engine.mode] + lane, false); cue.active = true;
      }
    }
    for (const [i, note] of this.engine.notes.entries()) {
      const event = note.event;
      if (!event) continue;
      const players = this.notePlayers[i];
      if (note.state === 1 && note.counter === 1) {
        const lane = event.channel % 10;
        players.body.select(event.channel >= 20 ? p.bar : event.channel >= 10 ? p.hold + lane : p.bar + 1 + lane);
        players.label.select(event.channel >= 20 || (event.channel >= 10 && event.holdIndex !== 0) ? p.emptyLabel : p.label + lane);
      }
      if (note.state === 1 && note.counter === 1 && note.bonus) {
        const base = [80, 158, 251][this.engine.mode];
        players.body.select(base + (note.bonus === 1 ? 1 : 0));
        players.label.select(base - (note.bonus === 1 ? 1 : 2));
      }
      players.body.update(this.#delta);
    }
    for (const event of this.engine.feedback) {
      if (event.kind === "miss") { this.#tierVisible = false; this.#lastMultiplier = 1; continue; }
      if (event.kind === "bonus") { this.#effect([53, 116, 194][this.engine.mode], 0, 0, -1, 400); continue; }
      if (event.kind !== "hit") continue;
      if (event.channel < 10) this.#effect([90, 168, 261][this.engine.mode], p.x + p.width * event.channel, 70);
      else if (!this.#effects.some(effect => effect.active && effect.holdLane === event.channel - 10)) this.#effect([92, 170, 263][this.engine.mode], p.x + p.width * (event.channel - 10), 70, event.channel - 10);
      if (event.channel < 10 || event.holdIndex === 0) {
        this.#effect([48, 111, 189][this.engine.mode] + event.grade);
        this.#vibrationDelay = 700;
        this.vibrate();
      }
      this.#vibrationDelay -= this.#delta;
      if (this.#vibrationDelay < 0 && event.channel >= 10 && event.holdIndex > 0) {
        this.#effect([52, 115, 193][this.engine.mode]);
        this.#vibrationDelay = 700;
        this.vibrate();
      }
      if (event.combo > 1) { this.#combo.select([46, 109, 187][this.engine.mode], false); this.#comboCount = event.combo; this.#comboVisible = true; }
      if (event.combo > 1) {
        const multiplier = event.combo <= 19 ? 1 : event.combo <= 39 ? 2 : event.combo <= 69 ? 3 : event.combo <= 99 ? 4 : 5;
        if (multiplier !== this.#lastMultiplier) {
          this.#lastMultiplier = multiplier;
          this.#tierVisible = multiplier > 1;
          this.#tierIntro = true;
          this.#tier.select([38, 101, 179][this.engine.mode] + multiplier * 2 - 3);
        }
      }
    }
    for (const effect of this.#effects) {
      if (effect.active && effect.holdLane >= 0 && !(this.engine.heldMask & (1 << effect.holdLane))) effect.ending = true;
      if (effect.ending) { effect.active = false; effect.free = true; effect.ending = false; }
      else if (effect.active && effect.remaining !== undefined) {
        effect.remaining -= this.#delta;
        if (effect.remaining < 0) effect.ending = true;
      }
      else if (effect.active && effect.player.update(this.#delta)) {
        if (effect.holdLane < 0) effect.ending = true;
        else if (effect.settle) { effect.player.select(effect.player.animation - 1); effect.settle = false; }
      }
    }
    if (this.#comboVisible && this.#combo.update(this.#delta)) this.#comboEnding = true;
    if (this.#tierVisible && this.#tier.update(this.#delta) && this.#tierIntro) { this.#tier.select(this.#tier.animation - 1); this.#tierIntro = false; }
  }
  draw(target: Rgb565Framebuffer): void {
    const p = PROGRAMS[this.engine.mode];
    for (const cue of this.#cues) {
      if (!cue.active) continue;
      const complete = cue.player.update(this.#delta);
      cue.player.draw(target);
      if (complete) cue.active = false;
    }
    for (const player of this.background) player.draw(target);
    // Native render queue 0x11fb60 prepends objects at equal depth.
    for (let i = this.engine.notes.length - 1; i >= 0; i--) {
      const note = this.engine.notes[i];
      if (note.free || !note.event || note.event.channel === 20) continue;
      const lane = note.event.channel >= 20 ? 0 : note.event.channel % 10;
      const x = p.x + lane * p.width;
      const origin = target.height - note.y / 65536;
      this.notePlayers[i].label.draw(target, x, origin);
      const holdScale = note.event.holdSpeed / 65536;
      this.notePlayers[i].body.draw(target, x, origin + (holdScale > 0 ? 8 * holdScale - 8 / 65536 : 0), holdScale || 1);
    }
    // The parent sets the native play flag: 0x1125e8 omits side animation 0xe0.
    for (const index of [1, 2, 3, 6, 7]) this.hud[index].draw(target);
    for (const player of this.keys) player.draw(target);
    const main = this.hud[1];
    const animation = this.archive.animations[main.animation];
    for (const marker of animation?.frames[main.frame - animation.firstFrame]?.markers ?? []) {
      if (marker.id === 20) {
        let score = this.engine.scoring.score;
        for (let i = 0;i < 7;i++) {
          drawVrpFrameBottomUp(target, this.archive, 265, score % 10, marker.x - i * 14, target.height - marker.y);
          score = Math.trunc(score / 10);
        }
      } else if (marker.id === 21 || marker.id === 22) this.hud[marker.id === 21 ? 4 : 5].draw(target, marker.x, target.height - marker.y);
    }
    if (this.#tierVisible) this.#tier.draw(target);
    if (this.#comboVisible) {
      this.#combo.draw(target);
      const marker = this.archive.animations[this.#combo.animation]?.frames[0]?.markers.find(marker => marker.id === 10);
      if (marker) {
        const digits = String(this.#comboCount).slice(-4);
        for (let i = 0;i < digits.length;i++) drawVrpFrameBottomUp(target, this.archive, this.#combo.animation + 1, Number(digits[i]), marker.x + (i - digits.length / 2) * 28, target.height - marker.y);
      }
    }
    for (let i = this.#effects.length - 1; i >= 0; i--) {
      const effect = this.#effects[i];
      if (effect.active) effect.player.draw(target, effect.x, target.height - effect.y);
    }
  }
}
