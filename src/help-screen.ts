import type { GameKey } from './game';
import { GameFont } from './font';
import { Rgb565Framebuffer } from './framebuffer';
import { parseVrp, VrpPlayer, drawVrpFrameBottomUp } from './vrp';
import { HELP_TEXT, CREDITS_TEXT } from './help-text';

/** Native help/credits child states 1 and 6, 0x110f6c. */
export class HelpScreen {
  page = 0;
  credits = false;
  readonly #archive;
  readonly #font;
  readonly #players: VrpPlayer[];
  constructor(read: (path: string) => Uint8Array) {
    this.#archive = parseVrp(read('res/Vrp/MusicSelect_Help.vrp'));
    this.#font = new GameFont(read('res/Font/hfont_wg.fnt'), read('res/Font/efont_12_8.fnt'));
    this.#players = [9, 0, 4, 6, 8].map(animation => new VrpPlayer(this.#archive, animation));
  }
  enter(credits = false): void { this.credits = credits; this.page = 0; this.#players[1].select(credits ? 1 : 0); }
  update(delta: number, keys: ReadonlySet<GameKey>): boolean {
    if (this.credits) return keys.has('back') || keys.has('ok');
    this.#players[4].update(delta);
    if (this.#players[2].update(delta)) this.#players[2].select(4);
    if (this.#players[3].update(delta)) this.#players[3].select(6);
    if (keys.has('star')) { this.page = Math.max(0, this.page - 1); this.#players[2].select(5); }
    else if (keys.has('hash')) { this.page = Math.min(12, this.page + 1); this.#players[3].select(7); }
    else if (keys.has('back')) return true;
    return false;
  }
  draw(target: Rgb565Framebuffer): void {
    for (const player of this.#players) player.draw(target);
    for (const [value, x] of [[this.page + 1, 102], [this.credits ? 1 : 13, 141]]) {
      drawVrpFrameBottomUp(target, this.#archive, 3, value % 10, x, 300);
      drawVrpFrameBottomUp(target, this.#archive, 3, Math.trunc(value / 10), x - 12, 300);
    }
    if (!this.credits && this.page === 12) {
      for (let y = 112;y < 234;y++) target.pixels.fill(0x2584, y * target.width + 50, y * target.width + 200);
    }
    this.#font.draw(target, this.credits ? CREDITS_TEXT : HELP_TEXT[this.page], 50, 100, 150, 170, 0);
  }
}
