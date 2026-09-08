import type { GameKey } from "./game";
import { GameFont } from "./font";
import type { Rgb565Framebuffer } from "./framebuffer";
import type { RhythmStarIo } from "./io";
import { SaveData, SOUND_LEVELS } from "./save-data";
import { drawVrpFrameBottomUp, parseVrp, VrpArchive, VrpPlayer } from "./vrp";

export type MenuPhase = "scores" | "options" | "trophies" | "report" | "rankingStart" | "rankingConfirm" | "rankingError";
export const MENU_STATE_IDS: Record<MenuPhase, number> = {
  scores: 11, options: 13, trophies: 33, report: 34, rankingStart: 32, rankingConfirm: 31, rankingError: 30,
};

/** State handlers 0x10b6ec, 0x10af68, 0x10b384 and child 0x110f6c. */
export class MenuScreens {
  phase: MenuPhase = "scores";
  page = 0;
  row = 0;
  scoreSelection = 1;
  trophySelection = 0;
  #background = 87;
  #base: VrpPlayer[] = [];
  #dynamic: VrpPlayer[] = [];
  #report: VrpPlayer[] = [];
  #dialog: VrpPlayer[] = [];
  #yes = true;
  readonly #archive: VrpArchive;
  #help: VrpArchive | undefined;
  #window: VrpArchive | undefined;
  readonly #font: GameFont;

  constructor(readonly io: RhythmStarIo, readonly save: SaveData, readonly read: (path: string) => Uint8Array) {
    this.#archive = parseVrp(read("res/Vrp/MusicSelect2.vrp"));
    this.#font = new GameFont(read("res/Font/hfont_wg.fnt"), read("res/Font/efont_12_8.fnt"));
  }

  enter(phase: MenuPhase): void {
    const previous = this.phase;
    this.phase = phase;
    const players = (ids: number[]) => ids.map(id => new VrpPlayer(this.#archive, id));
    if (phase === "options") {
      this.page = this.row = 0;
      this.#background = 34;
      this.#base = players([55]);
      this.#dynamic = players([67, 44, 46, 54, 50, 51, 59, 56, 58, 35]);
      this.#refreshOptions();
    } else if (phase === "scores") {
      this.#background = 87;
      this.scoreSelection = previous === "trophies" ? 0 : 1;
      this.#base = players([91, 88, 90]);
      this.#dynamic = players([89]);
      this.#dialog = [];
    } else if (phase === "trophies") {
      if (previous !== "report") {
        this.trophySelection = 0;
        this.#background = 93;
        this.#base = players([100, 98]);
        this.#dynamic = players([99, 97]);
      }
      this.#report = [];
    } else if (phase === "report") {
      this.page = 0;
      this.#help ??= parseVrp(this.read("res/Vrp/MusicSelect_Help.vrp"));
      this.#report = [9, 2, 4, 6, 8].map(id => new VrpPlayer(this.#help!, id));
    } else if (phase === "rankingStart") {
      // 0x10b62c supplies carrier/client identification before the prompt.
      this.save.bytes.set(new TextEncoder().encode("ANB(KTF)\0"), 0x110);
      this.save.bytes.set(new TextEncoder().encode("K\0"), 0x10);
    } else {
      this.#yes = true;
      this.#window ??= parseVrp(this.read("res/Vrp/MusicSelect_Window.vrp"));
      this.#dialog = [1, phase === "rankingConfirm" ? 11 : 10, 9, 9, 9].map(id => new VrpPlayer(this.#window!, id));
      this.#effect("EffectWindowOpen");
    }
  }

  update(delta: number, keys: ReadonlySet<GameKey>): MenuPhase | "mainMenu" | undefined {
    const has = (key: GameKey) => keys.has(key);
    if (this.phase === "rankingStart") return "rankingConfirm";
    if (this.phase === "rankingConfirm" || this.phase === "rankingError") {
      this.#dialog[2].update(delta);
      if (this.phase === "rankingError") {
        if (has("ok") || has("back")) return "scores";
      } else if (has("left")) this.#yes = true;
      else if (has("right")) this.#yes = false;
      else if (has("back") || (has("ok") && !this.#yes)) return "scores";
      else if (has("ok")) {
        // The original state 30 delegates to the carrier network client.
        // No browser replacement service exists: surface a failed connection.
        this.io.trace.record("network.unavailable", { service: "KTF ranking" });
        return "rankingError";
      }
      this.#dialog[1].frame = this.#yes ? 0 : 1;
      return;
    }
    if (this.phase === "report") {
      this.#report[4].update(delta);
      if (this.#report[2].update(delta)) this.#report[2].select(4);
      if (this.#report[3].update(delta)) this.#report[3].select(6);
      if (has("star")) { this.page = Math.max(0, this.page - 1); this.#report[2].select(5); }
      else if (has("hash")) { this.page = Math.min(3, this.page + 1); this.#report[3].select(7); }
      else if (has("back")) return "trophies";
      return;
    }
    for (const player of this.#base) player.update(delta);
    if (this.phase === "scores") {
      // Native setFrame precedes the input branch, intentionally one tick late.
      this.#dynamic[0].frame = this.scoreSelection;
      if (has("up") || has("down")) {
        const next = has("up") ? 1 : 0;
        if (next !== this.scoreSelection) { this.scoreSelection = next; this.#effect("EffectKeyChange"); }
      } else if (has("ok")) return this.scoreSelection ? "rankingStart" : "trophies";
      else if (has("back")) return "mainMenu";
    } else if (this.phase === "trophies") {
      this.#dynamic[1].frame = this.trophySelection;
      if (has("left")) this.trophySelection = Math.max(0, this.trophySelection - 1);
      else if (has("right")) this.trophySelection = Math.min(11, this.trophySelection + 1);
      else if (has("up")) { if (this.trophySelection >= 3) this.trophySelection -= 3; }
      else if (has("down")) { if (this.trophySelection < 9) this.trophySelection += 3; }
      else if (has("back")) return "scores";
      else if (has("star")) return "report";
    } else {
      const p = this.#dynamic;
      if (p[1].update(delta)) p[1].select(44);
      if (p[2].update(delta)) p[2].select(46);
      for (const index of this.row ? [7, 9] : [5, 6, 9]) p[index].update(delta);
      if (has("up") || has("down")) {
        if (this.page === 0) {
          this.row = has("up") ? 0 : 1;
          p[3].select(54 - this.row);
          p[4].select(50 - this.row);
        }
      } else if (has("left") || has("right")) {
        const direction = has("left") ? -1 : 1;
        if (this.page === 0 && this.row === 0) {
          this.save.volume = Math.max(0, Math.min(5, this.save.volume + direction));
          this.io.music.setVolume(SOUND_LEVELS[this.save.volume]);
          this.#effect("EffectWindowOpen");
        } else if (this.page === 0) {
          const wasEnabled = this.save.vibrationEnabled;
          this.save.vibrationEnabled = direction < 0;
          if (!wasEnabled && this.save.vibrationEnabled) {
            this.io.vibration.pulse(100);
            this.io.trace.record("vibration.pulse", { milliseconds: 100 });
          }
        }
        else if (this.page === 1) this.save.delay = Math.max(-600, Math.min(600, this.save.delay + direction * 200));
        else this.save.sync = Math.max(-3, Math.min(3, this.save.sync + direction));
        this.#refreshOptions();
      } else if (has("star") || has("hash")) {
        this.page = Math.max(0, Math.min(2, this.page + (has("star") ? -1 : 1)));
        p[has("star") ? 1 : 2].select(has("star") ? 45 : 47);
        this.#refreshOptions();
      } else if (has("back") || has("ok")) {
        this.io.storage.write("savedata.dat", this.save.bytes);
        this.io.trace.record("storage.write", { name: "savedata.dat", size: this.save.bytes.length });
        return "mainMenu";
      }
    }
  }

  #refreshOptions(): void {
    const p = this.#dynamic;
    if (this.page === 0) {
      p[0].select(67);
      p[3].select(54 - this.row); p[4].select(50 - this.row);
      p[5].select(this.save.volume ? 52 : 51);
      p[6].select(this.save.volume ? 58 + this.save.volume : 43);
      p[7].select(this.save.vibrationEnabled ? 57 : 56);
      p[8].select(58); p[8].frame = this.save.vibrationEnabled ? 0 : 1;
      p[9].select(43);
    } else {
      p[0].select(this.page === 1 ? 66 : 65);
      p[3].select(54); p[4].select(48);
      for (const index of [5, 6, 7, 8]) p[index].select(43);
      p[9].select(38 + (this.page === 1 ? Math.trunc(this.save.delay / 200) : this.save.sync));
    }
  }

  draw(target: Rgb565Framebuffer): void {
    drawVrpFrameBottomUp(target, this.#archive, this.#background, 0);
    for (const player of [...this.#base, ...this.#dynamic]) player.draw(target);
    if (this.phase === "trophies") {
      // 0x10cd38: marker positions in animation 99; persistent counts +0x28c.
      for (let index = 0;index < 12;index++) {
        const count = this.save.view.getInt32(0x28c + index * 4, true);
        const x = 63 + (index % 3) * 57;
        const origin = 118 + Math.floor(index / 3) * 45;
        drawVrpFrameBottomUp(target, this.#archive, 94, count ? index : 12, x, origin);
        if (count) {
          let position = x + 16;
          for (const digit of String(count).split("").reverse()) {
            drawVrpFrameBottomUp(target, this.#archive, 96, Number(digit), position, origin);
            position -= 6;
          }
          drawVrpFrameBottomUp(target, this.#archive, 96, 10, position, origin);
        }
      }
      drawVrpFrameBottomUp(target, this.#archive, 95, this.trophySelection, 50, 291);
      if (this.save.view.getInt32(0x28c + this.trophySelection * 4, true)) {
        const descriptions = ["5시간이상 플레이", "콤보 누적 5000개", "음표 누적 500개", "5곡이상 A등급", "5곡이상 S등급", "기본곡 All S등급", "5곡이상 미러모드 A등급", "5곡이상 랜덤모드 A등급", "5곡이상 0.5배속 A등급", "5곡이상 3배속 A등급", "모든 행성 치유", "다운로드5곡 이상"];
        this.#font.draw(target, descriptions[this.trophySelection], 36, 295, 170, 16, 0);
      }
    } else if (this.phase === "options" && this.page > 0) {
      this.#font.draw(target, this.page === 1
        ? "사운드가 노트보다 빠르거나 느릴 경우, 아래의 값을 조절해 주십시오."
        : "사운드가 약간씩 느려지는 경우, 아래의 값을 조절해 주십시오.", 36, 132, 170, 40, 0);
    } else if (this.phase === "report" && this.#help) {
      for (const player of this.#report) player.draw(target);
      for (const [number, x] of [[this.page + 1, 102], [4, 141]]) {
        drawVrpFrameBottomUp(target, this.#help, 3, number, x, 300);
        drawVrpFrameBottomUp(target, this.#help, 3, 0, x - 12, 300);
      }
      this.#font.draw(target, this.#reportText(), 50, 100, 150, 170, 0);
    } else if (this.#dialog.length) {
      for (const player of this.#dialog) player.draw(target);
      this.#font.draw(target, this.phase === "rankingConfirm"
        ? "네트워크에 접속시, \rY데이터통화료\rU가 부과됩니다. 접속하시겠습니까?"
        : "오류가 발생했습니다.", 40, 114, 164, 86, 0xffff);
    }
  }

  #reportText(): string {
    const read = (offset: number) => this.save.view.getInt32(offset, true);
    const lines = (title: string, first: string, rest: string[]) => `[${title}]\n\rV${first}\n\n\rg${rest.join("\n")}`;
    if (this.page === 0) return lines("기본정보", `총플레이시간: \rg${Number(this.save.view.getBigInt64(0x2c4, true) / 60000n)}분`, [
      `총플레이 수: ${read(0x2cc)}회`, `총클리어 수: ${read(0x2d0)}회`, `게임오버 수: ${read(0x2d4)}회`, "",
      `다운로드 곡수: ${read(0x2d8)}곡`, `캐시구매 곡수: ${read(0x2e0)}곡`, `음표구매 곡수: ${read(0x2dc)}곡`,
    ]);
    if (this.page === 1) return lines("Grade 정보", `총 스코어: \rg${read(0x2e4)}점`,
      Array.from("SABCDEF", (grade, i) => `${grade}등급 획득: ${read(0x2e8 + i * 4)}회`));
    if (this.page === 2) return lines("Combo 정보", `총 누적콤보: \rg${read(0x304)}`, [
      `총플레이 수: ${read(0x2cc)}회`, ...["100%", "90%", "80%", "70%", "60%", "60%미만"].map((label, i) => `${label} 콤보: ${read(0x308 + i * 4)}회`),
    ]);
    return lines("음표정보", `총 얻은음표: \rg${read(0x320)}개`, [
      `음표 획득수: ${read(0x324)}회`, `왕음표 획득수: ${read(0x328)}회`, "", `총 사용음표: ${read(0x32c)}개`, `총 보유음표: ${read(0x330)}개`,
    ]);
  }

  #effect(name: string): void {
    const resource = `res/Mmf/${name}.mmf`;
    this.io.music.playEffect(this.read(resource));
    this.io.trace.record("sound.play", { resource });
  }
}
