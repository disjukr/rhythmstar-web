import { Rgb565Framebuffer } from "./framebuffer";
import { BitmapFont } from "./font";
import { RhythmStarIo } from "./io";
import {
  BACKGROUND_MUSIC,
  COMMON_BACKGROUND_ANIMATION,
  MENU_BACKGROUND_ANIMATION,
  MENU_BASE_ANIMATIONS,
  MENU_INITIAL_ANIMATION,
  MENU_ITEMS,
  MENU_STAR_ANIMATION,
  MENU_STAR_COUNT,
  STARTUP_ANIMATIONS,
  STARTUP_EFFECTS,
  STARTUP_ORIGIN,
  TITLE_ANIMATIONS,
} from "./original-program";
import { drawVrpFrameBottomUp, parseVrp, VrpArchive, VrpPlayer } from "./vrp";
import { nativeCosine, nativeSine } from "./original-math";
import { MenuScreens, MENU_STATE_IDS, MenuPhase } from "./menu-screens";
import { SelectionScreens, SELECTION_STATE_IDS, SelectionPhase } from "./selection-screens";
import { SaveData, SOUND_LEVELS } from "./save-data";
import { GameSession } from "./game-session";
import { DownloadScreen } from "./download-screen";
import { PlanetScreen } from "./planet-screen";
import { HelpScreen } from "./help-screen";

export type GameLifecycle = "created" | "running" | "stopped";
export type GamePhase = "anbGames" | "carrier3330" | "titleTransition" | "title" | "mainMenu" | "gameplay" | "download" | "planet" | "help" | "credits" | MenuPhase | SelectionPhase;
export type GameKey = "up" | "down" | "left" | "right" | "ok" | "back" | "star" | "hash" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

export type RhythmStarState = Readonly<{
  lifecycle: GameLifecycle;
  frame: number;
  startedAt: number | null;
  savedataPresent: boolean;
  deviceProfile: DeviceProfile;
  phase: GamePhase;
  phaseStartedAt: number | null;
  menuSelection: number;
  menuAnimation: number;
  menuAnimationStartedAt: number | null;
}>;

type DeviceProfile = Readonly<{
  model: string;
  sync: number;
  delay: number;
  vibrationValue: number;
  vibrationEnabled: boolean;
}>;

type MenuStar = { startX: number; startY: number; elapsed: number; x: number; y: number };

const DEFAULT_DEVICE_PROFILE: DeviceProfile = {
  model: "Emulator",
  sync: 0,
  delay: 0,
  vibrationValue: 0,
  vibrationEnabled: false,
};

const parseDeviceProfiles = (bytes: Uint8Array): DeviceProfile[] => {
  const text = new TextDecoder("euc-kr").decode(bytes);
  const profiles: DeviceProfile[] = [];
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("//")) continue;
    const [model, sync, delay, vibrationValue, vibrationEnabled] = line.split(/\s+/);
    if (!model || vibrationEnabled === undefined) continue;
    profiles.push({
      model,
      sync: Number.parseInt(sync, 10),
      delay: Number.parseInt(delay, 10),
      vibrationValue: Number.parseInt(vibrationValue, 10),
      vibrationEnabled: vibrationEnabled !== "0",
    });
  }
  return profiles;
};

export class RhythmStarGame {
  readonly #screen = new Rgb565Framebuffer(240, 320);
  readonly #offscreen = new Rgb565Framebuffer(240, 320);
  #cancelTimer: (() => void) | undefined;
  #state: RhythmStarState = {
    lifecycle: "created",
    frame: 0,
    startedAt: null,
    savedataPresent: false,
    deviceProfile: DEFAULT_DEVICE_PROFILE,
    phase: "anbGames",
    phaseStartedAt: null,
    menuSelection: 0,
    menuAnimation: MENU_INITIAL_ANIMATION,
    menuAnimationStartedAt: null,
  };
  #logoVrp: VrpArchive | undefined;
  #titleVrp: VrpArchive | undefined;
  #musicSelectVrp: VrpArchive | undefined;
  #englishFont: BitmapFont | undefined;
  #menuStars: MenuStar[] = [];
  // Runtime construction at 0x001156cc passes the literal seed 0x4d2 to
  // the RNG owner. No earlier caller consumes this generator.
  #randomState = 0x4d2;
  #lastTickAt = 0;
  #logoPlayer: VrpPlayer | undefined;
  #players: VrpPlayer[] = [];
  #selectedPlayer: VrpPlayer | undefined;
  #pendingPhase: "title" | "mainMenu" | "restart" | "gameplay" | "download" | "planet" | "help" | "credits" | MenuPhase | SelectionPhase | undefined;
  #save: SaveData | undefined;
  #menus: MenuScreens | undefined;
  #selection: SelectionScreens | undefined;
  #session: GameSession | undefined;
  #help: HelpScreen | undefined;
  #planet: PlanetScreen | undefined;
  #download: DownloadScreen | undefined;
  readonly #keys = new Set<GameKey>();
  readonly #heldKeys = new Set<GameKey>();

  constructor(readonly io: RhythmStarIo) { }

  get state(): RhythmStarState {
    return this.#state;
  }

  start(): void {
    if (this.#state.lifecycle !== "created") return;

    const { trace } = this.io;
    trace.record("lifecycle.startApp");
    trace.record("display.create", { width: 240, height: 320, format: "rgb565" });
    trace.record("framebuffer.create", { target: "screen", width: 240, height: 320 });
    trace.record("framebuffer.create", { target: "offscreen", width: 240, height: 320 });

    this.io.backlight.configure(true, 0xffffffff, 3_600_000);
    trace.record("backlight.configure", { enabled: true, color: 0xffffffff, timeoutMilliseconds: 3_600_000 });
    trace.record("clock.read", { value: this.io.clock.now() });

    this.#cancelTimer = this.io.clock.every(50, () => this.tick());
    trace.record("timer.schedule", { intervalMilliseconds: 50 });
    trace.record("system.property", { name: "PHONEMODEL", value: "Emulator" });
    trace.record("system.property", { name: "PHONENUMBER", value: "" });

    const savedata = this.io.storage.read("savedata.dat");
    trace.record("storage.read", { name: "savedata.dat", found: savedata !== undefined, size: savedata?.byteLength ?? 0 });

    const init = this.#readResource("res/Init/Init.txt");
    const profiles = parseDeviceProfiles(init);
    const deviceProfile = profiles.find(profile => profile.model === "Emulator") ?? DEFAULT_DEVICE_PROFILE;
    this.#save = new SaveData(savedata, deviceProfile);
    this.io.music.setVolume(SOUND_LEVELS[this.#save.volume] ?? SOUND_LEVELS[3]);
    this.#readResource("res/Font/hfont_wg.fnt");
    this.#englishFont = new BitmapFont(this.#readResource("res/Font/efont_12_8.fnt"));
    for (const path of STARTUP_EFFECTS) this.#readResource(path);
    this.#logoVrp = parseVrp(this.#readResource("res/Vrp/anblogo.vrp"));
    this.#logoPlayer = new VrpPlayer(this.#logoVrp, STARTUP_ANIMATIONS.anbGames, false);

    const startedAt = this.io.clock.now();
    this.#lastTickAt = startedAt;
    this.#state = {
      lifecycle: "running",
      frame: 0,
      startedAt,
      savedataPresent: savedata !== undefined,
      deviceProfile,
      phase: "anbGames",
      phaseStartedAt: startedAt,
      menuSelection: 0,
      menuAnimation: MENU_INITIAL_ANIMATION,
      menuAnimationStartedAt: null,
    };
    trace.record("state.enter", { state: 6, phase: "anbGames", animation: STARTUP_ANIMATIONS.anbGames });
    trace.record("lifecycle.startApp.return");
  }

  tick(): void {
    if (this.#state.lifecycle !== "running") return;

    if (this.#pendingPhase === "restart") {
      this.stop();
      this.#pendingPhase = undefined;
      this.#menus = undefined;
      this.#selection = undefined;
      this.#session = undefined;
      this.#help = undefined;
      this.#planet = undefined;
      this.#download = undefined;
      this.#players = [];
      this.#selectedPlayer = undefined;
      this.#menuStars = [];
      this.#keys.clear();
      this.#heldKeys.clear();
      this.#randomState = 0x4d2;
      this.#state = { ...this.#state, lifecycle: "created" };
      this.start();
      return;
    }

    const now = this.io.clock.now();
    const delta = Math.max(0, now - this.#lastTickAt);
    this.#lastTickAt = now;
    if (this.#save) this.#save.view.setBigUint64(0x2c4, this.#save.view.getBigUint64(0x2c4, true) + BigInt(Math.trunc(delta)), true);
    if (this.#pendingPhase === "title") {
      this.#titleVrp ??= parseVrp(this.#readResource("res/Vrp/MusicSelect_Title.vrp"));
      const archive = this.#titleVrp;
      this.#players = TITLE_ANIMATIONS.map(animation => new VrpPlayer(archive, animation));
      this.#state = { ...this.#state, phase: "title", phaseStartedAt: now };
      this.io.trace.record("state.enter", { state: 8, phase: "title" });
      this.#playMusic(BACKGROUND_MUSIC.title);
    } else if (this.#pendingPhase === "mainMenu") {
      this.#musicSelectVrp ??= parseVrp(this.#readResource("res/Vrp/MusicSelect1.vrp"));
      const archive = this.#musicSelectVrp;
      this.#players = MENU_BASE_ANIMATIONS.map(animation => new VrpPlayer(archive, animation));
      const animation = this.#state.phase === "title" ? MENU_INITIAL_ANIMATION : MENU_ITEMS[this.#state.menuSelection].rightAnimation;
      this.#selectedPlayer = new VrpPlayer(this.#musicSelectVrp, animation, false);
      if (this.#state.phase !== "title") {
        const selected = archive.animations[animation];
        if (selected) this.#selectedPlayer.position = selected.durationTicks;
      }
      this.#menuStars = Array.from({ length: MENU_STAR_COUNT }, (_, index) => this.#createMenuStar(index));
      this.#state = { ...this.#state, phase: "mainMenu", phaseStartedAt: now, menuAnimation: animation, menuAnimationStartedAt: now };
      this.io.trace.record("state.enter", { state: 9, phase: "mainMenu" });
      this.io.music.stop();
      this.io.trace.record("music.stop");
      this.#playMusic(BACKGROUND_MUSIC.mainMenu);
    } else if (this.#pendingPhase === "keySelect" || this.#pendingPhase === "songSelect") {
      if (!this.#save) throw new Error("Save data was not initialized");
      this.#selection ??= new SelectionScreens(this.io, this.#save, this.#readResource);
      this.#selection.enter(this.#pendingPhase);
      this.#state = { ...this.#state, phase: this.#pendingPhase, phaseStartedAt: now };
      this.io.trace.record("state.enter", { state: SELECTION_STATE_IDS[this.#pendingPhase], phase: this.#pendingPhase });
    } else if (this.#pendingPhase === "download") {
      this.#download = new DownloadScreen(this.io, this.#readResource);
      this.#state = { ...this.#state, phase: "download", phaseStartedAt: now };
      this.io.trace.record("state.enter", { state: 12, phase: "download" });
    } else if (this.#pendingPhase === "planet") {
      this.#planet = new PlanetScreen(this.#save!, this.io, this.#readResource);
      this.#state = { ...this.#state, phase: "planet", phaseStartedAt: now };
      this.io.trace.record("state.enter", { state: 21, phase: "planet" });
    } else if (this.#pendingPhase === "gameplay") {
      const selection = this.#selection!;
      this.#session = new GameSession(selection.selected!, selection.mode, this.#save!, selection.records, this.io, this.#readResource, () => this.#nextRandom());
      this.#state = { ...this.#state, phase: "gameplay", phaseStartedAt: now };
    } else if (this.#pendingPhase === "help" || this.#pendingPhase === "credits") {
      this.#help ??= new HelpScreen(this.#readResource);
      this.#help.enter(this.#pendingPhase === "credits");
      this.#state = { ...this.#state, phase: this.#pendingPhase, phaseStartedAt: now };
    } else if (this.#pendingPhase) {
      if (!this.#save) throw new Error("Save data was not initialized");
      this.#menus ??= new MenuScreens(this.io, this.#save, this.#readResource);
      this.#menus.enter(this.#pendingPhase);
      this.#state = { ...this.#state, phase: this.#pendingPhase, phaseStartedAt: now };
      this.io.trace.record("state.enter", { state: MENU_STATE_IDS[this.#pendingPhase], phase: this.#pendingPhase });
    }
    this.#pendingPhase = undefined;
    if (this.#state.phase === "anbGames" || this.#state.phase === "carrier3330") {
      if (!this.#logoPlayer) throw new Error("Startup player was not initialized");
      const complete = this.#logoPlayer.update(delta);
      if (complete || this.#keys.size > 0) {
        if (this.#state.phase === "anbGames") {
          this.#logoPlayer.select(STARTUP_ANIMATIONS.carrier3330, false);
          this.#state = { ...this.#state, phase: "carrier3330", phaseStartedAt: now };
          this.io.trace.record("state.stage", { state: 6, phase: "carrier3330", animation: 0 });
        } else {
          this.#logoPlayer = undefined;
          this.#pendingPhase = "title";
          this.#state = { ...this.#state, phase: "titleTransition", phaseStartedAt: now };
          this.io.trace.record("state.request", { from: 6, to: 8 });
        }
      }
    } else if (this.#state.phase === "help" || this.#state.phase === "credits") {
      if (this.#help?.update(delta, this.#keys)) this.#pendingPhase = "mainMenu";
    } else if (this.#state.phase === "download") {
      const next = this.#download?.update(delta, this.#keys);
      if (next) this.#pendingPhase = next;
    } else if (this.#state.phase === "planet") {
      if (this.#planet?.update(delta, this.#keys)) this.#pendingPhase = "songSelect";
    } else if (this.#state.phase === "gameplay") {
      const next = this.#session?.update(now, delta, this.#keys, this.#heldKeys);
      if (next) this.#pendingPhase = next;
    } else if (this.#state.phase in SELECTION_STATE_IDS) {
      const next = this.#selection?.update(delta, this.#keys);
      if (next) this.#pendingPhase = next;
    } else if (this.#state.phase in MENU_STATE_IDS) {
      const next = this.#menus?.update(delta, this.#keys);
      if (next) {
        this.#pendingPhase = next;
        this.io.trace.record("state.request", { from: MENU_STATE_IDS[this.#state.phase as MenuPhase], to: next === "mainMenu" ? 9 : MENU_STATE_IDS[next] });
      }
    } else {
      for (const player of this.#players) player.update(delta);
      if (this.#state.phase === "title" && this.#keys.size > 0) {
        this.#pendingPhase = "mainMenu";
        this.io.trace.record("state.request", { from: 8, to: 9 });
      } else if (this.#state.phase === "mainMenu") {
        this.#selectedPlayer?.update(delta);
        if (this.#keys.has("left")) this.#selectMenu("left", now);
        else if (this.#keys.has("right")) this.#selectMenu("right", now);
        else if (this.#keys.has("ok")) {
          const destination = MENU_ITEMS[this.#state.menuSelection].state;
          if (destination === 10 || destination === 11 || destination === 13) {
            this.#pendingPhase = destination === 10 ? "keySelect" : destination === 11 ? "scores" : "options";
            this.io.music.stop();
            this.io.trace.record("music.stop");
            this.io.trace.record("state.request", { from: 9, to: destination });
          } else if (destination === 12) {
            this.#pendingPhase = "download";
          } else if (destination === 14 || destination === 15) {
            this.#pendingPhase = destination === 14 ? "help" : "credits";
          } else if (destination === 16) {
            this.#pendingPhase = "restart";
            this.io.trace.record("lifecycle.restart.request");
          }
        }
        for (const star of this.#menuStars) this.#updateMenuStar(star, delta);
      }
    }
    this.#keys.clear();
    const elapsed = now - (this.#state.phaseStartedAt ?? now);
    // The state renderer clears the offscreen surface to RGB(0, 0, 0) on
    // every paint. The opaque white objects in anblogo.vrp establish the
    // visible white background before its blended logo objects are drawn.
    this.#offscreen.clear(0x0000);
    if (this.#state.phase === "anbGames" || this.#state.phase === "carrier3330") {
      if (!this.#logoVrp) throw new Error("ANB logo VRP was not loaded");
      const animation = this.#state.phase === "anbGames" ? STARTUP_ANIMATIONS.anbGames : STARTUP_ANIMATIONS.carrier3330;
      this.#logoPlayer?.draw(this.#offscreen, STARTUP_ORIGIN.x, STARTUP_ORIGIN.y);
      this.io.trace.record("vrp.draw", { resource: "res/Vrp/anblogo.vrp", state: 6, phase: this.#state.phase, animation, elapsed });
    } else if (this.#state.phase === "titleTransition") {
      this.io.trace.record("graphics.clear", { color: 0x0000, reason: "state-request-delay" });
    } else if (this.#state.phase === "title") {
      if (!this.#titleVrp) throw new Error("title VRP was not loaded");
      drawVrpFrameBottomUp(this.#offscreen, this.#titleVrp, COMMON_BACKGROUND_ANIMATION, 0);
      for (const player of this.#players) player.draw(this.#offscreen);
      // 0x115de8: font 0, x=2, y=28, text box 120×20.
      if (this.#pendingPhase !== "mainMenu") this.#englishFont?.draw(this.#offscreen, "Ver 1.0.3", 2, 28, 0xffff, 0x0000);
      this.io.trace.record("vrp.draw", { resource: "res/Vrp/MusicSelect_Title.vrp", phase: "title", elapsed });
    } else if (this.#state.phase === "help" || this.#state.phase === "credits") {
      this.#help?.draw(this.#offscreen);
    } else if (this.#state.phase === "download") {
      this.#download?.draw(this.#offscreen);
    } else if (this.#state.phase === "planet") {
      this.#planet?.draw(this.#offscreen);
    } else if (this.#state.phase === "gameplay") {
      this.#session?.draw(this.#offscreen);
    } else if (this.#state.phase in SELECTION_STATE_IDS) {
      this.#selection?.draw(this.#offscreen);
    } else if (this.#state.phase in MENU_STATE_IDS) {
      this.#menus?.draw(this.#offscreen);
    } else {
      if (!this.#musicSelectVrp) throw new Error("music-select VRP was not loaded");
      drawVrpFrameBottomUp(this.#offscreen, this.#musicSelectVrp, MENU_BACKGROUND_ANIMATION, this.#state.menuSelection);
      for (const star of this.#menuStars) {
        drawVrpFrameBottomUp(this.#offscreen, this.#musicSelectVrp, MENU_STAR_ANIMATION, 0, star.x / 65536, this.#offscreen.height - star.y / 65536);
      }
      for (const player of this.#players) player.draw(this.#offscreen);
      this.#selectedPlayer?.draw(this.#offscreen);
      this.io.trace.record("vrp.draw", { resource: "res/Vrp/MusicSelect1.vrp", phase: "mainMenu", elapsed });
    }
    this.#screen.copyFrom(this.#offscreen);
    this.io.trace.record("graphics.copy", { source: "offscreen", target: "screen", x: 0, y: 0, width: 240, height: 320 });
    this.io.screen.present(this.#screen.width, this.#screen.height, this.#screen.pixels);
    const frame = this.#state.frame + 1;
    this.io.trace.record("screen.present", { frame, x: 0, y: 0, width: 240, height: 320 });
    this.#state = { ...this.#state, frame };
  }

  keyDown(key: GameKey): void {
    if (this.#state.lifecycle !== "running") return;
    this.io.trace.record("input.keyDown", { key, phase: this.#state.phase });
    this.#keys.add(key);
    this.#heldKeys.add(key);
  }
  keyUp(key: GameKey): void { this.#heldKeys.delete(key); }
  releaseKeys(): void { this.#heldKeys.clear(); this.#keys.clear(); }

  #selectMenu(key: "left" | "right", now: number): void {
    const oldSelection = this.#state.menuSelection;
    const selection = key === "left"
      ? (oldSelection - 1 + MENU_ITEMS.length) % MENU_ITEMS.length
      : (oldSelection + 1) % MENU_ITEMS.length;
    const animation = key === "left" ? MENU_ITEMS[oldSelection].leftAnimation : MENU_ITEMS[selection].rightAnimation;
    const startedAt = now;
    this.#selectedPlayer?.select(animation, false);
    this.#state = {
      ...this.#state,
      menuSelection: selection,
      menuAnimation: animation,
      menuAnimationStartedAt: startedAt,
    };
    this.io.music.playEffect(this.#readResource("res/Mmf/EffectMenuChange.mmf"));
    this.io.trace.record("sound.play", { resource: "res/Mmf/EffectMenuChange.mmf" });
    this.io.trace.record("menu.select", { index: selection, direction: key });
  }

  #playMusic(resource: string): void {
    this.io.music.play(this.#readResource(resource), true);
    this.io.trace.record("music.play", { resource, repeat: true });
  }

  stop(): void {
    if (this.#state.lifecycle === "stopped") return;
    this.io.music.stop();
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    this.#state = { ...this.#state, lifecycle: "stopped" };
    this.io.trace.record("lifecycle.stop");
  }

  readonly #readResource = (path: string): Uint8Array => {
    const bytes = this.io.resources.read(path);
    this.io.trace.record("resource.read", { path, size: bytes.byteLength });
    return bytes;
  };

  #nextRandom(): number {
    // Exact generator at 0x001197e4: state = state*0x343fd+0x269ec3,
    // returning the upper 16 bits.
    this.#randomState = (Math.imul(this.#randomState, 0x343fd) + 0x269ec3) >>> 0;
    return this.#randomState >>> 16;
  }

  #createMenuStar(initialIndex?: number): MenuStar {
    const horizontalCells = Math.floor(this.#offscreen.width / 32);
    const verticalCells = Math.floor(this.#offscreen.height / 32);
    const edgeCell = this.#nextRandom() % (horizontalCells + verticalCells);
    const offset = (initialIndex ?? 0) * 32;
    const startX = (edgeCell < verticalCells ? -30 + offset : (edgeCell - verticalCells) * 32 + offset) * 65536;
    const startY = (edgeCell < verticalCells ? edgeCell * 32 + offset : -30 + offset) * 65536;
    return { startX, startY, elapsed: 0, x: 0, y: 0 };
  }

  #updateMenuStar(star: MenuStar, delta: number): void {
    // 0x109330 retains 16.16 elapsed seconds; 0x109438 sets a 30px
    // off-screen respawn margin. A respawn retains this turn's draw position.
    star.elapsed += Math.trunc(delta * 65536 / 1000);
    const angle = Math.trunc(80 * 205887 / 180);
    star.x = star.startX + Math.floor(star.elapsed * (nativeCosine(angle) * 50) / 65536);
    star.y = star.startY + Math.floor(star.elapsed * (nativeSine(angle) * 50) / 65536);
    if (star.x > (this.#offscreen.width + 30) * 65536 || star.y > (this.#offscreen.height + 30) * 65536) {
      const replacement = this.#createMenuStar();
      star.startX = replacement.startX;
      star.startY = replacement.startY;
      star.elapsed = 0;
    }
  }
}
