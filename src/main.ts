import { KeyboardInput } from "./input";
import { mountVirtualKeyboard } from "./virtual-keyboard";
import { BrowserMusic } from "./audio";
import { loadResources } from "./resources";
import { RhythmStarGame } from "./game";
import { BacklightPort, EffectTrace, ScreenPort, StoragePort } from "./io";
import { browserClock } from "./browser-clock";
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
  present(width: number, height: number, rgb565: Uint16Array): void {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const image = context.createImageData(width, height);
    for (let index = 0;index < rgb565.length;index += 1) {
      const pixel = rgb565[index];
      const destination = index * 4;
      image.data[destination] = ((pixel >>> 11) * 255) / 31;
      image.data[destination + 1] = (((pixel >>> 5) & 0x3f) * 255) / 63;
      image.data[destination + 2] = ((pixel & 0x1f) * 255) / 31;
      image.data[destination + 3] = 255;
    }
    context.putImageData(image, 0, 0);
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
    const game = new RhythmStarGame({
      resources,
      storage: new BrowserStorage(),
      clock: browserClock,
      screen: new BrowserScreen(),
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
      input.keyDown(event);
    });
    window.addEventListener("keyup", event => input.keyUp(event));
    window.addEventListener("blur", () => input.releaseKeys());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) input.releaseKeys();
    });
    window.addEventListener("pointerdown", () => music.unlock());
    window.addEventListener("beforeunload", () => { game.stop(); music.close(); }, { once: true });
  } catch (error) {
    console.error("Game loading failed:", error);
  }
};

void load();
