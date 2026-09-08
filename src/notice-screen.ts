import { GameFont } from "./font";
import type { Rgb565Framebuffer } from "./framebuffer";
import type { RhythmStarIo } from "./io";
import { drawVrpFrameBottomUp, parseVrp, VrpPlayer } from "./vrp";

/** Shared native dialog types 13 and 14 (0x10fa28 / 0x10f860). */
export class NoticeScreen {
  readonly #players;
  readonly #font;
  readonly #music;
  constructor(readonly trophy: number | undefined, io: RhythmStarIo, read: (path: string) => Uint8Array, readonly message?: string) {
    const window = parseVrp(read("res/Vrp/MusicSelect_Window.vrp"));
    this.#players = [1, 10, 9, 9, 9].map(id => new VrpPlayer(window, id));
    this.#music = parseVrp(read("res/Vrp/MusicSelect1.vrp"));
    this.#font = new GameFont(read("res/Font/hfont_wg.fnt"), read("res/Font/efont_12_8.fnt"));
    const resource = "res/Mmf/EffectWindowOpen.mmf";
    io.music.playEffect(read(resource));
    io.trace.record("sound.play", { resource });
  }
  update(delta: number): void { this.#players[2].update(delta); }
  draw(target: Rgb565Framebuffer): void {
    for (const player of this.#players) player.draw(target);
    if (this.trophy === undefined) {
      this.#font.draw(target, this.message ?? "\rD행성\rU을 치유했습니다.\n\n음악선택시 \rE좌우방향키\rU를 이용해서 \rD행성\rU을 바꿀 수 있습니다.", 40, 114, 164, 86);
    } else {
      this.#font.draw(target, "\rD트로피\rU를 얻었습니다!", 58, 122, 130, 28);
      drawVrpFrameBottomUp(target, this.#music, 152, this.trophy, 73, 180);
      drawVrpFrameBottomUp(target, this.#music, 153, this.trophy, 103, 180);
    }
  }
}
