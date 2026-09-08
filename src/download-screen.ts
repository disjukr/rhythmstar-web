import type { GameKey } from "./game";
import type { RhythmStarIo } from "./io";
import type { Rgb565Framebuffer } from "./framebuffer";
import { NoticeScreen } from "./notice-screen";
import { drawVrpFrameBottomUp, parseVrp, VrpPlayer } from "./vrp";

/** Native New Music menu (0x10bad4) and the empty local download list. */
export class DownloadScreen {
  selected = 1;
  readonly #common;
  readonly #archive;
  #base: VrpPlayer[];
  #empty = false;
  readonly #selection;
  #notice: NoticeScreen | undefined;
  constructor(readonly io: RhythmStarIo, readonly read: (path: string) => Uint8Array) {

    this.#archive = parseVrp(read("res/Vrp/MusicSelect2.vrp"));
    this.#common = this.#archive;
    this.#base = [27, 24, 26].map(id => new VrpPlayer(this.#archive, id));
    this.#selection = new VrpPlayer(this.#archive, 25);
    io.music.stop();
  }
  update(delta: number, keys: ReadonlySet<GameKey>): "mainMenu" | undefined {
    if (this.#notice) {
      this.#notice.update(delta);
      if (keys.has("ok") || keys.has("back")) {
        this.#notice = undefined;
        if (this.#empty) {
          this.#empty = false;
          this.#base = [27, 24, 26].map(id => new VrpPlayer(this.#archive, id));
        }
      }
      return;
    }
    for (const player of this.#base) player.update(delta);
    this.#selection.frame = this.selected;
    const previous = this.selected;
    if (keys.has("up")) this.selected = 1;
    else if (keys.has("down")) this.selected = 0;
    else if (keys.has("back")) return "mainMenu";
    else if (keys.has("ok")) {
      if (this.selected) this.io.trace.record("network.unavailable", { service: "KTF music download" });
      if (!this.selected) {
        this.#empty = true;
        this.#base = [9, 8, 2, 4, 6].map(id => new VrpPlayer(this.#archive, id));
      }
      this.#notice = new NoticeScreen(undefined, this.io, this.read, this.selected ? "오류가 발생했습니다." : "다운로드 받은 파일이 없습니다.");
    }
    if (previous !== this.selected) {
      const resource = "res/Mmf/EffectMenuChange.mmf";
      this.io.music.playEffect(this.read(resource));
      this.io.trace.record("sound.play", { resource });
    }
  }
  draw(target: Rgb565Framebuffer): void {
    drawVrpFrameBottomUp(target, this.#common, this.#empty ? 0 : 23, 0);
    for (const player of this.#base) player.draw(target);
    if (!this.#empty) this.#selection.draw(target);
    this.#notice?.draw(target);
  }
}
