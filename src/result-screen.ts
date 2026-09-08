import { NoticeScreen } from "./notice-screen";
import { RhythmChart } from "./chart";
import { GameScoring } from "./game-scoring";
import { GameKey } from "./game";
import { RhythmStarIo } from "./io";
import { Rgb565Framebuffer } from "./framebuffer";
import { musPicture } from "./mus-picture";
import { parseVrp, VrpPlayer, drawVrpFrameBottomUp } from "./vrp";

/** Native state 23, 0x10bd64; rows appear every five 50-ms updates. */
export class ResultScreen {
  readonly #archive;
  readonly #picture;
  readonly #base: VrpPlayer[];
  readonly #rank: VrpPlayer;
  stage = 0;
  #elapsed = 0;
  #rankPending = true;
  #notice: NoticeScreen | undefined;
  constructor(readonly chart: RhythmChart, readonly scoring: GameScoring, readonly io: RhythmStarIo, readonly read: (path: string) => Uint8Array, readonly trophy = -1) {
    this.#archive = parseVrp(read("res/Vrp/MusicSelect1.vrp"));
    this.#picture = parseVrp(musPicture(read(chart.id)));
    this.#base = [115, 116, 130].map(id => new VrpPlayer(this.#archive, id));
    this.#rank = new VrpPlayer(this.#archive, 118 + scoring.rank());
  }
  update(delta: number, keys: ReadonlySet<GameKey>): "songSelect" | undefined {
    for (const player of this.#base) player.update(delta);
    this.#elapsed += delta;
    if (this.#elapsed > 200) {
      this.#elapsed = 0;
      this.stage = Math.min(9, this.stage + 1);
      if (this.stage === 1) {
        this.io.music.playEffect(this.io.resources.read("res/Mmf/EffectResult.mmf"));
        this.io.trace.record("sound.play", { resource: "res/Mmf/EffectResult.mmf" });
      }
    }
    if (this.stage < 9) return;
    if (this.#rankPending) {
      if (this.#rank.update(delta)) {
        this.#rankPending = false;
        this.#rank.select(117);
        this.#rank.frame = this.scoring.rank();
      }
      return;
    }
    this.#notice?.update(delta);
    if (keys.size) {
      if (this.trophy < 0 || this.#notice) return "songSelect";
      this.#notice = new NoticeScreen(this.trophy, this.io, this.read);
    }
  }
  draw(target: Rgb565Framebuffer): void {
    drawVrpFrameBottomUp(target, this.#archive, 114, 0);
    for (const player of this.#base) player.draw(target);
    const markers = this.#archive.animations[114]?.frames[0]?.markers ?? [];
    const picture = markers.find(marker => marker.id === 13);
    if (picture) drawVrpFrameBottomUp(target, this.#picture, 0, 0, picture.x, target.height - picture.y);
    const [miss, bad, good, great, perfect] = this.scoring.counts;
    const values = [perfect, great, good, bad, miss, miss + bad + good + great + perfect, this.scoring.score, this.scoring.maxCombo];
    const digitAnimations = [128, 126, 125, 125, 125, 125, 129, 127];
    for (let stage = 1;stage <= this.stage;stage++) {
      if (stage === 9) { this.#rank.draw(target); continue; }
      drawVrpFrameBottomUp(target, this.#archive, 105 + stage, 0);
      const marker = markers.find(marker => marker.id === stage + 4);
      if (!marker) continue;
      let number = values[stage - 1];
      let digit = 0;
      do {
        drawVrpFrameBottomUp(target, this.#archive, digitAnimations[stage - 1], number % 10, marker.x - digit * 11, target.height - marker.y);
        number = Math.trunc(number / 10); digit++;
      } while (number > 0 && digit < (stage >= 7 ? 7 : 5));
    }
    this.#notice?.draw(target);
  }
}
