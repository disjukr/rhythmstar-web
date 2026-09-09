import type { GameKey } from "./game";

export type KeyBindings = Readonly<Record<GameKey, readonly string[]>>;

// KeyboardEvent.key values. Add aliases to an action's array; [] disables it.
// For example, "1": ["1", "a", "A"] also accepts A with or without Shift.
export const KEY_BINDINGS: KeyBindings = {
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  ok: ["Enter", " "],
  back: ["Escape", "Backspace"],
  star: ["*", "z", "Z"],
  hash: ["#", "c", "C"],
  "0": ["0", "x", "X"], "1": ["1"], "2": ["2"], "3": ["3"],
  "4": ["4", "q", "Q"], "5": ["5", "w", "W"], "6": ["6", "e", "E"],
  "7": ["7", "a", "A"], "8": ["8", "s", "S"], "9": ["9", "d", "D"],
};
