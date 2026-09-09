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
  const press = (source: string, key: GameKey): void => {
    input.press(source, key);
    navigator.vibrate?.(10);
  };
  const pointers = new Map<number, { x: number; y: number; key: GameKey | undefined }>();
  const buttons = new Map<GameKey, HTMLButtonElement>();
  const buttonKeys = new Map<Element, GameKey>();
  const move = (event: PointerEvent): void => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    // Sample the path so a fast swipe still hits keys between pointer events.
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
    for (let step = 1; step <= steps; step++) {
      const element = document.elementFromPoint(pointer.x + dx * step / steps, pointer.y + dy * step / steps);
      const key = element ? buttonKeys.get(element) : undefined;
      if (key === pointer.key) continue;
      input.release(`pointer:${event.pointerId}`);
      pointer.key = key;
      if (key !== undefined) press(`pointer:${event.pointerId}`, key);
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  };
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
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, key });
      press(`pointer:${event.pointerId}`, key);
    });
    button.addEventListener("pointermove", event => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      const samples = event.getCoalescedEvents?.() ?? [];
      for (const sample of samples) move(sample);
      move(event);
    });
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      button.addEventListener(eventName, event => release(event.pointerId));
    }
    // Keyboard and assistive-technology activation has no pointer sequence.
    button.addEventListener("click", event => {
      if (event.detail !== 0) return;
      const source = `virtual:${key}`;
      press(source, key);
      input.release(source);
    });
    container.append(button);
    buttons.set(key, button);
    buttonKeys.set(button, key);
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
