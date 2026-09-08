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
  star: ["*"],
  hash: ["#"],
  "0": ["0"], "1": ["1"], "2": ["2"], "3": ["3"], "4": ["4"],
  "5": ["5"], "6": ["6"], "7": ["7"], "8": ["8"], "9": ["9"],
};
