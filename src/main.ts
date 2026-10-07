import { KeyboardInput } from "./input";
import { mountVirtualKeyboard } from "./virtual-keyboard";
import { BrowserMusic, soundBanks } from "./audio";
import { loadResources } from "./resources";
import { RhythmStarGame } from "./game";
import { BacklightPort, EffectTrace, ScreenPort, StoragePort } from "./io";
import { browserClock } from "./browser-clock";
import { TitleRenderer } from './title-renderer';
import { UpscaledRenderer } from './upscaled-renderer';
import type { VrpArchive, VrpFrame } from './vrp';
const resourceUrls = import.meta.glob<string>("../assets/res/**/*", { query: "?url", import: "default", eager: true });

const requireElement = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing application element: ${selector}`);
  return element;
};

const canvas = requireElement<HTMLCanvasElement>("#game");
const getCanvasContext = (target: HTMLCanvasElement): CanvasRenderingContext2D => {
  const value = target.getContext("2d");
  if (!value) throw new Error("Canvas 2D is unavailable");
  return value;
};
const context = getCanvasContext(canvas);

class BrowserScreen implements ScreenPort {
  remastered = true;
  #nativeImage: ImageData | undefined;
  constructor(readonly title: TitleRenderer, readonly presentation: UpscaledRenderer) {}
  presentTitle(archive: VrpArchive, frames: readonly (VrpFrame | undefined)[], elapsed: number, showVersion: boolean): void {
    canvas.dataset.presentation = 'title';
    this.title.draw(canvas, archive, frames, elapsed, showVersion);
  }
  present(width: number, height: number, rgb565: Uint16Array): void {
    if (!this.remastered) {
      canvas.dataset.presentation = 'original';
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width; canvas.height = height;
      }
      if (!this.#nativeImage || this.#nativeImage.width !== width || this.#nativeImage.height !== height) {
        this.#nativeImage = context.createImageData(width, height);
      }
      const pixels = this.#nativeImage.data;
      for (let i = 0; i < rgb565.length; i++) {
        const color = rgb565[i], offset = i * 4;
        pixels[offset] = (color >>> 11) * 255 / 31;
        pixels[offset + 1] = ((color >>> 5) & 63) * 255 / 63;
        pixels[offset + 2] = (color & 31) * 255 / 31;
        pixels[offset + 3] = 255;
      }
      context.putImageData(this.#nativeImage, 0, 0);
      return;
    }
    canvas.dataset.presentation = 'upscaled';
    if (canvas.width !== width * 2 || canvas.height !== height * 2) {
      canvas.width = width * 2; canvas.height = height * 2;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(this.presentation.canvas, 0, 0);
  }

}

class BrowserStorage implements StoragePort {
  readonly #prefix = "rhythmstar1:";

  read(name: string): Uint8Array | undefined {
    const encoded = localStorage.getItem(this.#prefix + name);
    if (encoded === null) return undefined;
    return Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  }

  write(name: string, data: Uint8Array): void {
    let binary = "";
    for (const byte of data) binary += String.fromCharCode(byte);
    localStorage.setItem(this.#prefix + name, btoa(binary));
  }
}

const backlight: BacklightPort = {
  configure: enabled => {
    document.documentElement.dataset.backlight = enabled ? "on" : "off";
  },
};

context.fillStyle = "#000";
context.fillRect(0, 0, canvas.width, canvas.height);

const load = async (): Promise<void> => {
  try {
    const resources = await loadResources(Object.fromEntries(
      Object.entries(resourceUrls).map(([path, url]) => [path.slice("../assets/".length), url]),
    ));
    const trace = new EffectTrace();
    const music = new BrowserMusic(error => {
      console.error("Background music failed:", error);
    });
    const bankSelect = requireElement<HTMLSelectElement>("#soundfont");
    for (const bank of soundBanks) {
      bankSelect.add(new Option(bank.name, bank.url, false, bank.name === "SHS-10.SF2"));
    }
    let activeBank = bankSelect.value;
    void music.ready().then(() => {
      bankSelect.disabled = false;
    }).catch(() => { /* Initialization errors are reported by BrowserMusic. */ });
    bankSelect.addEventListener("change", async () => {
      bankSelect.disabled = true;
      music.unlock();
      try {
        await music.setSoundBank(bankSelect.value);
        activeBank = bankSelect.value;
      } catch (error) {
        console.error("Sound bank change failed:", error);
        bankSelect.value = activeBank;
      } finally {
        bankSelect.disabled = false;
      }
    });
    const [title, presentation] = await Promise.all([TitleRenderer.load(), UpscaledRenderer.load()]);
    const screen = new BrowserScreen(title, presentation);
    const game = new RhythmStarGame({
      resources,
      storage: new BrowserStorage(),
      clock: browserClock,
      screen,
      backlight,
      trace,
      music,
      vibration: { pulse: milliseconds => { navigator.vibrate?.(milliseconds); } },
    });
    const input = new KeyboardInput(game);
    mountVirtualKeyboard(requireElement<HTMLElement>("#virtual-keyboard"), input);
    game.start();
    window.addEventListener("keydown", event => {
      music.unlock();
      if (event.target instanceof Element && event.target.closest(".soundfont-controls")) return;
      if (event.key === 'Tab') {
        event.preventDefault();
        if (!event.repeat) {
          screen.remastered = !game.remastered;
          game.setRemastered(screen.remastered);
        }
        return;
      }
      input.keyDown(event);
    });
    window.addEventListener("keyup", event => input.keyUp(event));
    window.addEventListener("blur", () => input.releaseKeys());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) input.releaseKeys();
    });
    // Touch user activation happens on release. Capture also handles controls
    // that cancel default pointer behavior; keep these handlers synchronous.
    for (const eventName of ["pointerdown", "pointerup", "touchend", "click"] as const) {
      window.addEventListener(eventName, () => music.unlock(), { capture: true, passive: true });
    }
    window.addEventListener("beforeunload", () => { game.stop(); music.close(); }, { once: true });
  } catch (error) {
    console.error("Game loading failed:", error);
  }
};

void load();
