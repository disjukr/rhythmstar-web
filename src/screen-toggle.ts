// Keep this gesture on the display, separate from the virtual game keys.
export function mountScreenToggle(canvas: HTMLCanvasElement, toggle: () => void): () => void {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const maxDelay = 300;
  const maxDistance = 24;
  type Tap = { x: number; y: number; time: number };
  let start: (Tap & { id: number }) | undefined;
  let previous: Tap | undefined;
  let lastTouch = -Infinity;
  const reset = (): void => { start = undefined; previous = undefined; };
  const nearby = (tap: Tap, event: PointerEvent): boolean =>
    Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= maxDistance;

  canvas.addEventListener("dblclick", event => {
    // Touch browsers can synthesize mouse events after the pointer gesture.
    if (event.timeStamp - lastTouch < 700) return;
    toggle();
  }, options);
  canvas.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch") { reset(); return; }
    lastTouch = event.timeStamp;
    if (!event.isPrimary) { reset(); return; }
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
  }, options);
  canvas.addEventListener("pointermove", event => {
    if (start?.id === event.pointerId && !nearby(start, event)) reset();
  }, options);
  canvas.addEventListener("pointerup", event => {
    if (event.pointerType !== "touch") return;
    lastTouch = event.timeStamp;
    const tap = start;
    start = undefined;
    if (!tap || tap.id !== event.pointerId || event.timeStamp - tap.time > maxDelay || !nearby(tap, event)) {
      previous = undefined;
      return;
    }
    if (previous && event.timeStamp - previous.time <= maxDelay && nearby(previous, event)) {
      previous = undefined;
      toggle();
    } else {
      previous = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    }
  }, options);
  canvas.addEventListener("pointercancel", reset, options);
  window.addEventListener("blur", reset, options);
  document.addEventListener("visibilitychange", reset, options);
  return () => { controller.abort(); reset(); };
}
