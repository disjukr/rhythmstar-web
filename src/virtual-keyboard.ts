import type { GameKey } from "./game";
import type { KeyboardInput } from "./input";

const KEYS: readonly (readonly [GameKey, string, string])[] = [
  ["ok", "확인", "확인"], ["up", "▲", "위"], ["back", "취소", "취소"],
  ["left", "◀", "왼쪽"], ["down", "▼", "아래"], ["right", "▶", "오른쪽"],
  ["1", "1", "1"], ["2", "2", "2"], ["3", "3", "3"],
  ["4", "4", "4"], ["5", "5", "5"], ["6", "6", "6"],
  ["7", "7", "7"], ["8", "8", "8"], ["9", "9", "9"],
  ["star", "*", "별표"], ["0", "0", "0"], ["hash", "#", "우물정"],
];

export function mountVirtualKeyboard(container: HTMLElement, input: KeyboardInput): void {
  const pointers = new Map<number, HTMLButtonElement>();
  const buttons = new Map<GameKey, HTMLButtonElement>();
  const release = (pointerId: number): void => {
    pointers.delete(pointerId);
    input.release(`pointer:${pointerId}`);
  };
  const reset = (): void => {
    for (const pointerId of pointers.keys()) release(pointerId);
  };

  for (const [key, label, accessibleLabel] of KEYS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", accessibleLabel);
    button.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, button);
      input.press(`pointer:${event.pointerId}`, key);
    });
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      button.addEventListener(eventName, event => release(event.pointerId));
    }
    // Keyboard and assistive-technology activation has no pointer sequence.
    button.addEventListener("click", event => {
      if (event.detail !== 0) return;
      const source = `virtual:${key}`;
      input.press(source, key);
      input.release(source);
    });
    container.append(button);
    buttons.set(key, button);
  }
  input.onPressedChange(keys => {
    for (const [key, button] of buttons) button.classList.toggle("pressed", keys.has(key));
  });
  container.addEventListener("contextmenu", event => event.preventDefault());
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) reset();
  });
  window.matchMedia("(max-width: 600px), (pointer: coarse)").addEventListener("change", reset);
}
