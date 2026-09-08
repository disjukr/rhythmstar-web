import type { GameKey } from "./game";
import type { RhythmStarIo } from "./io";
import type { Rgb565Framebuffer } from "./framebuffer";
import { GameFont } from "./font";
import { SaveData } from "./save-data";
import { RhythmChart } from "./chart";
import { musPicture } from "./mus-picture";
import { loadSongCatalog } from "./song-catalog";
import { MusicRecords } from "./music-records";
import { parseVrp, VrpArchive, VrpPlayer, drawVrpFrameBottomUp } from "./vrp";

export type SelectionPhase = "keySelect" | "songSelect";
export const SELECTION_STATE_IDS = { keySelect: 10, songSelect: 20 };
// 0x137068: native planet table (mirror/random, speed indicator).
const PLANET_OPTIONS = [[0, 1], [0, 2], [0, 3], [2, 0], [1, 0], [2, 1], [2, 2], [2, 3], [1, 1], [1, 2], [1, 3]];
const DOWNLOAD = "\rB최신곡\rU 다운받기";
const HINT = "\rD[행성치유란?]\rU\n게임중에 얻은 \rY음표\rU로 \rD행성\rU을 치유하면, 그 \rD행성\rU을 골라 플레이할 수 있습니다.\n\rD행성\rU을 선택하면 \rE다양한 옵션\rU이 적용됩니다.\n";

/** Native handlers 0x10c170 and 0x10e828. */
export class SelectionScreens {
  phase: SelectionPhase = "keySelect";
  mode = 0;
  song = 0;
  hint = false;
  #base: VrpPlayer[] = [];
  #dynamic: VrpPlayer[] = [];
  #titles: string[] = [];
  #scroll = 0;
  #delta = 50;
  #stable = true;
  #planetStable = true;
  #dialog: VrpPlayer[] = [];
  #picture: VrpArchive | undefined;
  readonly #archive: VrpArchive;
  readonly #font: GameFont;
  readonly #catalog: RhythmChart[][];
  readonly #pictures = new Map<string, VrpArchive>();
  readonly records: MusicRecords;
  constructor(readonly io: RhythmStarIo, readonly save: SaveData, readonly read: (path: string) => Uint8Array) {
    this.#archive = parseVrp(read("res/Vrp/MusicSelect1.vrp"));
    this.#font = new GameFont(read("res/Font/hfont_wg.fnt"), read("res/Font/efont_12_8.fnt"));
    this.#catalog = loadSongCatalog(read);
    this.records = new MusicRecords(this.#catalog.flat(), read, io.storage.read("musicdata.dat"));
  }
  get selected(): RhythmChart | undefined { return this.#catalog[this.mode][this.song]; }
  enter(phase: SelectionPhase): void {
    const previous = this.phase;
    this.phase = phase;
    const players = (ids: number[]) => ids.map(id => new VrpPlayer(this.#archive, id));
    if (phase === "keySelect") {
      this.mode = 0;
      this.hint = false;
      this.#base = players([13, 12, 4]);
      this.#dynamic = players([11, 5, 8]);
      this.io.music.stop();
      this.io.trace.record("music.stop");
    } else {
      if (previous === "keySelect") this.song = 0;
      this.#stable = this.#planetStable = true;
      const planet = this.save.view.getInt32(0x224, true);
      const animation = planet < 0 ? 102 : 58 + planet * 4;
      this.#base = players([104]);
      this.#dynamic = players([animation, animation, 43, 49, 50, 52, 44]);
      if (this.#hasPlanets()) this.#dynamic.push(new VrpPlayer(this.#archive, 53));
      this.#refreshPlanet();
      this.#refreshSong();
      this.#refreshTitles();
      this.#preview();
      this.hint = this.save.view.getInt32(0x2c0, true) === 0;
      if (this.hint) {
        const window = parseVrp(this.read("res/Vrp/MusicSelect_Window.vrp"));
        this.#dialog = [1, 10, 9, 9, 9].map(id => new VrpPlayer(window, id));
        this.#effect("EffectWindowOpen");
      }
    }
  }
  update(delta: number, keys: ReadonlySet<GameKey>): SelectionPhase | "mainMenu" | "gameplay" | "planet" | "download" | undefined {
    this.#delta = delta;
    const has = (key: GameKey) => keys.has(key);
    if (this.phase === "keySelect") {
      for (const p of this.#base) p.update(delta);
      this.#dynamic[1].update(delta); this.#dynamic[2].update(delta);
      if (has("up") || has("down")) {
        this.mode = (this.mode + (has("up") ? 2 : 1)) % 3;
        this.#dynamic[0].frame = this.mode;
        this.#dynamic[1].select(5 + this.mode); this.#dynamic[2].select(8 + this.mode);
        this.#effect("EffectKeyChange");
      } else if (has("ok")) return "songSelect";
      else if (has("back")) return "mainMenu";
      return;
    }
    if (this.hint) {
      if (has("ok")) {
        this.hint = false;
        this.save.view.setInt32(0x2c0, 1, true);
        this.#preview(); this.#save();
      }
      return;
    }
    for (const p of this.#base) p.update(delta);
    if (this.#dynamic[2].update(delta)) this.#dynamic[2].select(43);
    if (!this.#planetStable) {
      this.#dynamic[0].update(delta);
      if (this.#dynamic[1].update(delta)) { this.#planetStable = true; this.#preview(); }
    }
    if (!this.#stable) {
      if (this.#dynamic[5].update(delta)) {
        this.#dynamic[5].select(52); this.#stable = true;
        this.#refreshTitles(); this.#preview();
      }
    } else this.#dynamic[2].update(delta);
    this.#dynamic[6].update(delta); this.#dynamic[7]?.update(delta);
    if (!this.#stable) return;
    if (has("left") || has("right")) this.#planet(has("left") ? -1 : 1);
    else if (has("up") || has("down")) {
      const up = has("up");
      this.song += up ? -1 : 1;
      const count = this.#catalog[this.mode].length;
      if (this.song < -1) this.song = count - 1;
      if (this.song > count) this.song = 0;
      this.#refreshSong();
      this.#stable = false;
      this.#dynamic[2].select(42, false);
      this.#dynamic[5].select(up ? 51 : 54, false);
      this.#effect("EffectMusicChange");
    } else if (has("back")) return "keySelect";
    else if (has("ok")) {
      if (this.selected) return "gameplay";
      return "download";
    }
    else if (has("hash")) return "planet";
  }
  draw(target: Rgb565Framebuffer): void {
    drawVrpFrameBottomUp(target, this.#archive, 41, 0);
    for (const p of [...this.#base, ...this.#dynamic]) p.draw(target);
    if (this.phase === "keySelect") return;
    const marker = (animation: number, frame: number, id: number) => this.#archive.animations[animation]?.frames[frame - (this.#archive.animations[animation]?.firstFrame ?? 0)]?.markers.find(m => m.id === id);
    const common = (id: number) => marker(41, 0, id);
    if (this.#stable && this.selected) {
      drawVrpFrameBottomUp(target, this.#archive, 55, this.selected.level - (this.#archive.animations[55]?.firstFrame ?? 0));
      const picture = common(3);
      if (picture && this.#picture) drawVrpFrameBottomUp(target, this.#picture, 0, 0, picture.x, target.height - picture.y);
      const score = common(1);
      if (score) for (let i = 0;i < 7;i++) drawVrpFrameBottomUp(target, this.#archive, 48, Math.trunc(this.records.score(this.selected.id) / 10 ** i) % 10, score.x - i * 14, target.height - score.y);
    }
    const currency = common(2);
    if (currency) for (let i = 0;i < 4;i++) drawVrpFrameBottomUp(target, this.#archive, 47, Math.trunc(this.save.view.getInt32(0x228, true) / 10 ** i) % 10, currency.x - i * 12, target.height - currency.y);
    const list = this.#dynamic[5];
    for (const [id, row] of [[30, 2], [31, 1], [32, 3], [33, 0], [34, 4]]) {
      const m = marker(list.animation, list.frame, id);
      const title = this.#titles[row];
      if (!m || !title) continue;
      const width = [...title.replace(/\r./g, "")].reduce((sum, c) => sum + (c.charCodeAt(0) < 128 ? 6 : 12), 0);
      const y = Math.floor(target.height - m.y - 16), x = Math.floor(m.x);
      if (row === 2 && width > 100) {
        this.#scroll -= Math.floor(this.#delta * 15 * 65536 / 1000);
        if (this.#scroll < -width * 65536) this.#scroll = (m.x + 100) * 65536;
        this.#font.draw(target, title, Math.floor(m.x + this.#scroll / 65536), y, width * 2, 16, 0, { x, y, width: 100, height: 16 });
      } else this.#font.draw(target, title, x, y, 100, 16, 0);
    }
    if (this.hint) {
      for (const p of this.#dialog) p.draw(target);
      this.#font.draw(target, HINT, 40, 114, 164, 86);
    }
  }
  #refreshTitles(): void {
    this.#scroll = 0;
    const songs = this.#catalog[this.mode];
    this.#titles = [-2, -1, 0, 1, 2].map(offset => {
      const length = songs.length + 1;
      const index = ((this.song + offset) % length + length) % length;
      return index === songs.length ? DOWNLOAD : songs[index].title;
    });
  }
  #refreshSong(): void {
    const chart = this.selected;
    if (!chart) { this.#picture = undefined; return; }
    let picture = this.#pictures.get(chart.id);
    if (!picture) { picture = parseVrp(musPicture(this.read(chart.id))); this.#pictures.set(chart.id, picture); }
    this.#picture = picture;
  }
  #preview(): void {
    if (!this.selected) { this.io.music.stop(); return; }
    const resource = `res/Mmf/${this.selected.audioFilename}`;
    this.io.music.play(this.read(resource), false);
    this.io.trace.record("music.play", { resource, repeat: false });
  }
  #effect(name: string): void {
    const resource = `res/Mmf/${name}.mmf`;
    this.io.music.playEffect(this.read(resource)); this.io.trace.record("sound.play", { resource });
  }
  #hasPlanets(): boolean { return Array.from({ length: 11 }, (_, i) => this.save.view.getInt32(0x260 + i * 4, true)).some(Boolean); }
  #planet(direction: number): void {
    const old = this.save.view.getInt32(0x224, true);
    let next = old + direction;
    while (next >= 0 && next <= 10 && !this.save.view.getInt32(0x260 + next * 4, true)) next += direction;
    if (next > 10 || (old < 0 && next < 0)) return;
    next = Math.max(-1, next);
    this.save.view.setInt32(0x224, next, true); this.#save();
    this.#dynamic[0].select(direction < 0 ? 57 + old * 4 : 56 + next * 4, false);
    this.#dynamic[1].select(direction < 0 ? (next < 0 ? 103 : 59 + next * 4) : (old < 0 ? 102 : 58 + old * 4), false);
    this.#refreshPlanet();
    this.#planetStable = false; this.#dynamic[2].select(42, false); this.#effect("EffectStarChange");
  }
  #refreshPlanet(): void {
    const planet = this.save.view.getInt32(0x224, true);
    const [mirror, speed] = planet < 0 ? [0, 0] : PLANET_OPTIONS[planet];
    this.#dynamic[3].frame = mirror;
    this.#dynamic[4].frame = speed;
  }
  #save(): void { this.io.storage.write("savedata.dat", this.save.bytes.slice()); }
}
