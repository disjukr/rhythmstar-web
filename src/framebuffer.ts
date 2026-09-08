import { nativeCosine, nativeSine } from "./original-math";

export class Rgb565Framebuffer {
  readonly pixels: Uint16Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint16Array(width * height);
  }

  clear(color: number): void {
    this.pixels.fill(color & 0xffff);
  }

  setPixel(x: number, y: number, color: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels[y * this.width + x] = color & 0xffff;
  }

  copyFrom(source: Rgb565Framebuffer): void {
    if (source.width !== this.width || source.height !== this.height) throw new Error("프레임버퍼 크기가 일치하지 않습니다");
    this.pixels.set(source.pixels);
  }

  // 0x11e2a0 builds rows from the source channel; compositors index
  // (source << 5) + destination. The effect weights the source.
  static #blendChannel(source: number, destination: number, mode: number, effect: number): number {
    const scaledSource = Math.floor(source * effect / 16);
    if (mode === 1) return Math.floor((source * effect + destination * (16 - effect)) / 16);
    if (mode === 2) return Math.min(31, scaledSource + Math.floor(destination * (31 - scaledSource) / 31));
    if (mode === 3) return Math.min(31, Math.floor(destination * scaledSource / 31) + Math.floor(destination * (16 - effect) / 16));
    if (mode === 4) return Math.min(31, destination + scaledSource);
    return source;
  }

  static #blend(source: number, destination: number, mode: number, effect: number): number {
    if (mode === 0) return source;
    const red = Rgb565Framebuffer.#blendChannel(source >>> 11, destination >>> 11, mode, effect);
    // The native rotated compositor (0x00104a92..0x00104ac8) masks green
    // with 0x07e0, shifts it by six, and indexes the same 32x32 table as
    // red and blue. Bit 5 is deliberately discarded when a blend mode is
    // active; treating green as a 6-bit channel produces colors the game
    // never emits.
    const green = Rgb565Framebuffer.#blendChannel((source >>> 6) & 0x1f, (destination >>> 6) & 0x1f, mode, effect);
    const blue = Rgb565Framebuffer.#blendChannel(source & 0x1f, destination & 0x1f, mode, effect);
    return (red << 11) | (green << 6) | blue;
  }

  blit(source: Readonly<{ width: number; height: number; pixels: Uint16Array; opaque: Uint8Array; runs?: readonly (readonly { skip: number; length: number }[])[] }>, x: number, y: number): void {
    for (let sourceY = 0;sourceY < source.height;sourceY += 1) {
      const destinationY = y + sourceY;
      if (destinationY < 0 || destinationY >= this.height) continue;
      for (let sourceX = 0;sourceX < source.width;sourceX += 1) {
        const destinationX = x + sourceX;
        if (destinationX < 0 || destinationX >= this.width) continue;
        const sourceIndex = sourceY * source.width + sourceX;
        if (source.opaque[sourceIndex] === 0) continue;
        this.pixels[destinationY * this.width + destinationX] = source.pixels[sourceIndex];
      }
    }
  }

  blitScaled(
    source: Readonly<{ width: number; height: number; pixels: Uint16Array; opaque: Uint8Array; runs?: readonly (readonly { skip: number; length: number }[])[] }>,
    left: number,
    top: number,
    right: number,
    bottom: number,
    drawMode = 0,
    effect = 16,
  ): void {
    const reverseX = right < left;
    const reverseY = bottom < top;
    const destinationLeft = Math.floor(Math.min(left, right));
    const destinationRight = Math.ceil(Math.max(left, right));
    const destinationTop = Math.floor(Math.min(top, bottom));
    const destinationBottom = Math.ceil(Math.max(top, bottom));
    const width = destinationRight - destinationLeft;
    const height = destinationBottom - destinationTop;
    if (width === 0 || height === 0) return;
    for (let destinationY = Math.max(0, destinationTop);destinationY < Math.min(this.height, destinationBottom);destinationY += 1) {
      const sampledY = Math.min(source.height - 1, Math.floor(((destinationY - destinationTop) * source.height) / height));
      const sourceY = reverseY ? source.height - 1 - sampledY : sampledY;
      for (let destinationX = Math.max(0, destinationLeft);destinationX < Math.min(this.width, destinationRight);destinationX += 1) {
        const sampledX = Math.min(source.width - 1, Math.floor(((destinationX - destinationLeft) * source.width) / width));
        const sourceX = reverseX ? source.width - 1 - sampledX : sampledX;
        const sourceIndex = sourceY * source.width + sourceX;
        if (source.opaque[sourceIndex] === 0) continue;
        const destinationIndex = destinationY * this.width + destinationX;
        const sourcePixel = source.pixels[sourceIndex];
        this.pixels[destinationIndex] = Rgb565Framebuffer.#blend(sourcePixel, this.pixels[destinationIndex], drawMode, effect);
      }
    }
  }

  blitTransformed(
    source: Readonly<{ width: number; height: number; pixels: Uint16Array; opaque: Uint8Array; runs?: readonly (readonly { skip: number; length: number }[])[] }>,
    originX: number,
    originY: number,
    scaleX: number,
    scaleY: number,
    rotationRadians: number,
    drawMode = 0,
    effect = 16,
  ): void {
    if (rotationRadians !== 0) {
      this.#blitRotatedForward(source, originX, originY, scaleX, scaleY, rotationRadians, drawMode, effect);
      return;
    }

    // 0x125308 dispatches by the product, not by each axis. Even (0.5, 2)
    // takes the unscaled native path; preserve that behavior on menu shadows.
    const unitArea = Math.abs(Math.floor(scaleX * scaleY * 65536)) === 65536;
    const magnitudeX = unitArea ? 1 : Math.abs(scaleX);
    const magnitudeY = unitArea ? 1 : Math.abs(scaleY);
    if (magnitudeX === 0 || magnitudeY === 0) return;
    // 0x103d5c emits source pixels with fractional scale accumulators.
    // The inner accumulator starts over for each RLE literal run.
    let destinationY = originY;
    let rowFraction = 0;
    for (let sy = 0;sy < source.height;sy += 1) {
      rowFraction += magnitudeY;
      const rows = Math.floor(rowFraction);
      rowFraction -= rows;
      let destinationX = scaleX < 0 ? originX + Math.floor(source.width * magnitudeX) - 1 : originX;
      let runFraction = 0;
      let sx = 0;
      const runs = source.runs?.[sy] ?? [{ skip: 0, length: source.width }];
      for (const run of runs) {
        runFraction += run.skip * magnitudeX;
        const skipped = Math.floor(runFraction);
        runFraction -= skipped;
        destinationX += scaleX < 0 ? -skipped : skipped;
        sx += run.skip;
        runFraction += run.length * magnitudeX;
        const runEnd = destinationX + (scaleX < 0 ? -1 : 1) * Math.floor(runFraction);
        runFraction -= Math.floor(runFraction);
        let pixelFraction = 0;
        for (let i = 0;i < run.length;i += 1, sx += 1) {
          pixelFraction += magnitudeX;
          const columns = Math.floor(pixelFraction);
          pixelFraction -= columns;
          const index = sy * source.width + sx;
          for (let dx = 0;dx < columns;dx += 1) {
            for (let dy = 0;dy < rows;dy += 1) {
              const x = destinationX;
              const y = destinationY + dy;
              if (source.opaque[index] && x >= 0 && x < this.width && y >= 0 && y < this.height) {
                const destination = y * this.width + x;
                this.pixels[destination] = Rgb565Framebuffer.#blend(source.pixels[index], this.pixels[destination], drawMode, effect);
              }
            }
            destinationX += scaleX < 0 ? -1 : 1;
          }
        }
        destinationX = runEnd;
      }
      destinationY += rows;
    }
  }

  #blitRotatedForward(
    source: Readonly<{ width: number; height: number; pixels: Uint16Array; opaque: Uint8Array; runs?: readonly (readonly { skip: number; length: number }[])[] }>,
    originX: number,
    originY: number,
    scaleX: number,
    scaleY: number,
    rotationRadians: number,
    drawMode: number,
    effect: number,
  ): void {
    // 0x00104794 walks the source RLE pixels and advances 16.16 transformed
    // coordinates. It does not inverse-sample every destination pixel. That
    // distinction is visible in the title spotlights: the unmapped pixels
    // form the original sparse diagonal pattern instead of a filled polygon.
    const fixedOne = 65536;
    const angle = Math.floor(Math.round(rotationRadians * 65536 / (2 * Math.PI)) * 411774 / 65536);
    const cosine = nativeCosine(angle);
    const sine = nativeSine(angle);
    const verticalCosine = nativeCosine(angle + 102943);
    const verticalSine = nativeSine(angle + 102943);
    const scaledCosineX = Math.trunc(scaleX * cosine);
    const scaledSineX = Math.trunc(scaleX * sine);
    const scaledSineY = Math.trunc(scaleY * verticalCosine);
    const scaledCosineY = Math.trunc(scaleY * verticalSine);

    for (let sourceY = 0;sourceY < source.height;sourceY += 1) {
      const rowX = originX * fixedOne + sourceY * scaledSineY;
      const rowY = originY * fixedOne + sourceY * scaledCosineY;
      for (let sourceX = 0;sourceX < source.width;sourceX += 1) {
        const sourceIndex = sourceY * source.width + sourceX;
        if (source.opaque[sourceIndex] === 0) continue;
        const destinationX = Math.floor((rowX + sourceX * scaledCosineX) / fixedOne);
        const destinationY = Math.floor((rowY + sourceX * scaledSineX) / fixedOne);
        if (destinationX < 0 || destinationY < 0 || destinationX >= this.width || destinationY >= this.height) continue;
        const destinationIndex = destinationY * this.width + destinationX;
        this.pixels[destinationIndex] = Rgb565Framebuffer.#blend(
          source.pixels[sourceIndex],
          this.pixels[destinationIndex],
          drawMode,
          effect,
        );
      }
    }
  }
}
