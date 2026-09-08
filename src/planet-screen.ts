import { NoticeScreen } from './notice-screen';
import type { GameKey } from './game';
import type { RhythmStarIo } from './io';
import { Rgb565Framebuffer } from './framebuffer';
import { GameFont } from './font';
import { SaveData } from './save-data';
import { PLANETS } from './planets';
import { parseVrp, VrpPlayer, drawVrpFrameBottomUp } from './vrp';

/** Original planet healing child 0x10fe64 and renderer 0x10f38c. */
export class PlanetScreen {
  selected = 0;
  #notice: NoticeScreen | undefined;
  readonly #archive;
  readonly #help;
  readonly #font;
  readonly #base: VrpPlayer[];
  readonly #arrows: VrpPlayer[];
  readonly #highlight: VrpPlayer;
  constructor(readonly save: SaveData, readonly io: RhythmStarIo, readonly read: (path: string) => Uint8Array) {
    this.#archive = parseVrp(read('res/Vrp/MusicSelect1.vrp'));
    this.#help = parseVrp(read('res/Vrp/MusicSelect_Help.vrp'));
    this.#font = new GameFont(read('res/Font/hfont_wg.fnt'), read('res/Font/efont_12_8.fnt'));
    this.#base = [149, 133, 148].map(id => new VrpPlayer(this.#archive, id));
    this.#arrows = [143, 145].map(id => new VrpPlayer(this.#archive, id));
    this.#highlight = new VrpPlayer(this.#archive, 147);
  }
  update(delta: number, keys: ReadonlySet<GameKey>): boolean {
    if (this.#notice) { this.#notice.update(delta); if (keys.has('ok')) this.#notice = undefined; return false; }
    for (const player of this.#base) player.update(delta);
    for (const [i, player] of this.#arrows.entries()) if (player.update(delta)) player.select(143 + i * 2);
    if (keys.has('down')) this.selected = Math.min(10, this.selected + 1);
    else if (keys.has('up')) this.selected = Math.max(0, this.selected - 1);
    else if (keys.has('star')) { this.selected = Math.max(0, this.selected - 4); this.#arrows[0].select(144); }
    else if (keys.has('hash')) { this.selected = Math.min(10, this.selected + 4); this.#arrows[1].select(146); }
    else if (keys.has('ok')) {
      const currency = this.save.view.getInt32(0x228, true), unlocked = this.save.view.getInt32(0x260 + this.selected * 4, true);
      if (currency > 0 && !unlocked) {
        this.save.view.setInt32(0x228, currency - 1, true);
        const offset = 0x234 + this.selected * 4;
        const progress = this.save.view.getInt32(offset, true) + 1;
        this.save.view.setInt32(offset, progress, true);
        if (progress === PLANETS[this.selected].cost) { this.save.view.setInt32(0x260 + this.selected * 4, 1, true); this.#notice = new NoticeScreen(undefined, this.io, this.read); }
      }
    } else if (keys.has('back')) {
      this.io.storage.write('savedata.dat', this.save.bytes); return true;
    }
    this.#highlight.frame = this.selected % 4;
    return false;
  }
  draw(target: Rgb565Framebuffer): void {
    for (const player of [...this.#base, ...this.#arrows, this.#highlight]) player.draw(target);
    const markers = this.#archive.animations[149]!.frames[0].markers;
    const marker = (id: number) => markers.find(item => item.id === id)!;
    const page = Math.floor(this.selected / 4);
    for (let index = page * 4;index < Math.min(11, page * 4 + 4);index++) {
      const row = index % 4, position = marker(103 + row);
      drawVrpFrameBottomUp(target, this.#archive, 134, index, position.x, target.height - position.y);
      if (!this.save.view.getInt32(0x260 + index * 4, true)) drawVrpFrameBottomUp(target, this.#archive, 137 + row, 0);
      const notes = marker(107 + row), progress = this.save.view.getInt32(0x234 + index * 4, true);
      for (let n = 0;n < PLANETS[index].cost;n++) drawVrpFrameBottomUp(target, this.#archive, 141, n < progress ? 0 : 1, notes.x + n * 10, target.height - notes.y);
    }
    const unlocked = this.save.view.getInt32(0x260 + this.selected * 4, true);
    drawVrpFrameBottomUp(target, this.#archive, unlocked ? 135 : 136, unlocked ? this.selected : 0);
    const planet = PLANETS[this.selected];
    const multiplier = ['1.1', '1.2', '1.5', '1.4', '1.6', '1.6', '1.75', '2.1', '1.9', '2.0', '2.5'][this.selected];
    const speed = planet.speed < 65536 ? '0.5배속' : planet.speed > 131072 ? '3배속' : planet.speed > 65536 ? '2배속' : '배속없음';
    const description = `행성: \rF${planet.name}\rU\n점수: \rF${multiplier}배\rU\n옵션: \rF${speed}\rU\n     \rF${planet.mirror ? '미러모드' : planet.random ? '랜덤모드' : ''}\rU`;
    const text = marker(111);
    this.#font.draw(target, description, text.x, target.height - text.y, 120, 52, 0xffff);
    for (const [id, value] of [[100, page + 1], [101, 3]]) {
      const pos = marker(id);
      for (let i = 0;i < 2;i++) drawVrpFrameBottomUp(target, this.#help, 3, Math.trunc(value / 10 ** i) % 10, pos.x - i * 12, target.height - pos.y);
    }
    const currency = this.save.view.getInt32(0x228, true), pos = marker(102);
    for (let i = 0;i < 4;i++) drawVrpFrameBottomUp(target, this.#archive, 142, Math.trunc(currency / 10 ** i) % 10, pos.x - i * 11, target.height - pos.y);
    this.#notice?.draw(target);
  }
}
