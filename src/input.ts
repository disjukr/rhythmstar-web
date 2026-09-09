import type { GameKey } from "./game";
import { KEY_BINDINGS, type KeyBindings } from "./key-bindings";

type KeyEvent = Pick<KeyboardEvent, "key" | "code" | "repeat" | "preventDefault">;
type InputTarget = { keyDown(key: GameKey): void; keyUp(key: GameKey): void; releaseKeys(): void };

export class KeyboardInput {
  readonly #bindings = new Map<string, GameKey>();
  readonly #pressed = new Map<string, GameKey>();
  readonly #listeners = new Set<(keys: ReadonlySet<GameKey>) => void>();

  onPressedChange(listener: (keys: ReadonlySet<GameKey>) => void): () => void {
    this.#listeners.add(listener);
    listener(new Set(this.#pressed.values()));
    return () => { this.#listeners.delete(listener); };
  }

  #notifyPressedChange(): void {
    const keys = new Set(this.#pressed.values());
    for (const listener of this.#listeners) listener(keys);
  }

  constructor(readonly target: InputTarget, bindings: KeyBindings = KEY_BINDINGS) {
    for (const action of Object.keys(bindings) as GameKey[]) {
      for (const key of bindings[action]) {
        const previous = this.#bindings.get(key);
        if (previous !== undefined && previous !== action) throw new Error(`Keyboard key ${JSON.stringify(key)} is bound to both ${previous} and ${action}`);
        this.#bindings.set(key, action);
      }
    }
  }

  keyDown(event: KeyEvent): void {
    const physicalKey = event.code || event.key;
    const action = this.#pressed.get(physicalKey) ?? this.#bindings.get(event.key);
    if (action === undefined) return;
    event.preventDefault();
    if (event.repeat || this.#pressed.has(physicalKey)) return;
    this.press(physicalKey, action);
  }

  keyUp(event: KeyEvent): void {
    const physicalKey = event.code || event.key;
    const action = this.#pressed.get(physicalKey);
    if (action === undefined) return;
    event.preventDefault();
    this.release(physicalKey);
  }

  press(source: string, action: GameKey): void {
    if (this.#pressed.has(source)) return;
    const alreadyHeld = [...this.#pressed.values()].includes(action);
    this.#pressed.set(source, action);
    if (!alreadyHeld) {
      this.target.keyDown(action);
      this.#notifyPressedChange();
    }
  }

  release(source: string): void {
    const action = this.#pressed.get(source);
    if (action === undefined) return;
    this.#pressed.delete(source);
    // Releasing one alias must not release a long note held by another key.
    if (![...this.#pressed.values()].includes(action)) {
      this.target.keyUp(action);
      this.#notifyPressedChange();
    }
  }

  releaseKeys(): void {
    this.#pressed.clear();
    this.target.releaseKeys();
    this.#notifyPressedChange();
  }
}
