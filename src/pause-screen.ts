import type { GameKey } from "./game";
import type { RhythmStarIo } from "./io";
import { Rgb565Framebuffer } from "./framebuffer";
import { SaveData, SOUND_LEVELS } from "./save-data";
import { GameFont } from "./font";
import { parseVrp, VrpPlayer } from "./vrp";

/** Native in-game menu child 0x11061c; interruption restarts the song. */
export class PauseScreen {
  row = 0;
  readonly players: VrpPlayer[];
  readonly #font: GameFont;
  #dialog: VrpPlayer[] = [];
  constructor(readonly save: SaveData, readonly io: RhythmStarIo, readonly read: (path: string) => Uint8Array) {
    const archive = parseVrp(read("res/Vrp/MainGame.vrp"));
    this.players = [0, 15, 1, 2, 4, 18, 19, 21, 24, 6, 17, 25, 7].map(id => new VrpPlayer(archive, id));
    this.#font = new GameFont(read("res/Font/hfont_wg.fnt"), read("res/Font/efont_12_8.fnt"));
    this.#volume(); this.#vibration();
  }
  #volume(): void {
    this.players[11].frame = this.save.volume;
    this.players[10].select(this.save.volume ? 17 : 16);
  }
  #vibration(): void {
    this.players[9].frame = this.save.vibrationEnabled ? 0 : 1;
    this.players[8].select(this.save.vibrationEnabled ? 24 : 23);
  }
  #save(): void {
    this.io.storage.write("savedata.dat", this.save.bytes);
    this.io.trace.record("storage.write", { name: "savedata.dat", size: this.save.bytes.length });
  }
  update(delta: number, keys: ReadonlySet<GameKey>): "playing" | "songSelect" | "report" | "restart" | undefined {
    if (this.#dialog.length) { if (keys.has("ok")) return "playing"; return; }
    this.players[1].frame = this.row;
    this.players[5].frame = this.save.sync + 3;
    this.players[2].frame = Math.trunc((this.save.delay + 600) / 200);
    for (const index of [12, 8, 10]) this.players[index].update(delta);
    const digit = ["1", "2", "3", "4", "5", "6", "7", "8"].findIndex(key => keys.has(key as GameKey));
    if (digit >= 0) { this.row = digit; this.players[12].select(7 + this.row); }
    if (digit === 0 || keys.has("ok") && this.row === 0) { this.#save(); return "playing"; }
    if (digit === 1 || keys.has("ok") && this.row === 1) { this.#save(); return "songSelect"; }
    if (digit === 6 || keys.has("ok") && this.row === 6) return "report";
    if (digit === 7 || keys.has("ok") && this.row === 7) { this.#save(); return "restart"; }
    const direction = keys.has("left") ? -1 : keys.has("right") ? 1 : 0;
    if ((digit === 2 || direction && this.row === 2)) {
      this.save.volume = digit === 2 ? (this.save.volume + 1) % 6 : Math.max(0, Math.min(5, this.save.volume + direction));
      this.io.music.setVolume(SOUND_LEVELS[this.save.volume]); this.#volume();
      if (this.save.volume) {
        const resource = "res/Mmf/EffectWindowOpen.mmf";
        this.io.music.playEffect(this.read(resource)); this.io.trace.record("sound.play", { resource });
      }
    } else if (digit === 3 || direction && this.row === 3) {
      const previous = this.save.vibrationEnabled;
      this.save.vibrationEnabled = digit === 3 ? !previous : direction < 0;
      if (!previous && this.save.vibrationEnabled) this.io.vibration.pulse(100);
      this.#vibration();
    } else if (digit === 4 || direction && this.row === 4) {
      const next = this.save.delay + (digit === 4 ? 200 : direction * 200);
      this.save.delay = digit === 4 ? next > 600 ? -600 : next : Math.max(-600, Math.min(600, next));
    } else if (digit === 5 || direction && this.row === 5) {
      const next = this.save.sync + (digit === 5 ? 1 : direction);
      this.save.sync = digit === 5 ? next > 3 ? -3 : next : Math.max(-3, Math.min(3, next));
    } else if (keys.has("up") || keys.has("down")) {
      this.row = (this.row + (keys.has("up") ? 7 : 1)) % 8;
      this.players[12].select(7 + this.row);
    } else if (keys.has("back")) {
      this.#save();
      const archive = parseVrp(this.read("res/Vrp/MusicSelect_Window.vrp"));
      this.#dialog = [1, 10, 9, 9, 9].map(id => new VrpPlayer(archive, id));
    }
  }
  draw(target: Rgb565Framebuffer): void {
    if (this.#dialog.length) {
      for (const player of this.#dialog) player.draw(target);
      this.#font.draw(target, "\rY폰\rU에서는 \rD사운드\rU를 \rD일시정지\rU할 수 없어, \rE다시 시작\rU해야합니다.", 40, 114, 164, 86, 0xffff);
    } else for (const player of this.players) player.draw(target);
  }
}
