import { Rgb565Framebuffer } from "./framebuffer";

export type VrpSprite = Readonly<{
  width: number;
  height: number;
  pixels: Uint16Array;
  opaque: Uint8Array;
  runs: readonly (readonly { skip: number; length: number }[])[];
}>;

export type VrpArchive = Readonly<{
  sprites: readonly VrpSprite[];
  animations: readonly (VrpAnimation | undefined)[];
}>;

export type VrpObject = Readonly<{
  sprite: number;
  scaleX: number;
  scaleY: number;
  drawMode: number;
  effect: number;
  rotation: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}>;

export type VrpFrame = Readonly<{
  objects: readonly VrpObject[];
  markers: readonly { id: number; x: number; y: number }[];
}>;

export type VrpAnimation = Readonly<{
  firstFrame: number;
  durationTicks: number;
  durationMilliseconds: number;
  frames: readonly VrpFrame[];
}>;

const MAGIC = 0x0ab60000;
const VERSION = 0x00021000;
const OBJECT_SCALE_ONE = 64;
// 0x00126046 multiplies the signed object rotation by 0x0006487e,
// which is 2π in 16.16 fixed point. The stored rotation is therefore a
// signed 16.16 fraction of one turn, not a 12-bit (4096-step) angle.
const OBJECT_ROTATION_TURN = 65536;

// 0x1001 is the native renderer's direct-copy fast path. Other combinations
// index the four 17-level channel tables built by 0x11e1fc.
const blendMode = (object: VrpObject): number => object.drawMode === 1 && object.effect === 16 && object.rotation === 0 ? 0 : object.drawMode;

const readU32 = (view: DataView, offset: number): number => view.getUint32(offset, true);

export const parseVrp = (bytes: Uint8Array): VrpArchive => {
  if (bytes.byteLength < 36) throw new Error("VRP header is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readU32(view, 0) !== MAGIC || readU32(view, 4) !== VERSION) throw new Error("Unsupported VRP format");
  if (readU32(view, 8) !== bytes.byteLength) throw new Error("VRP file size does not match its header");

  const paletteTable = readU32(view, 24);
  const spriteTable = readU32(view, 28);
  const spriteDataEnd = readU32(view, 32);
  const paletteCount = readU32(view, paletteTable);
  const palettes: Uint16Array[] = [];
  for (let paletteIndex = 0;paletteIndex < paletteCount;paletteIndex += 1) {
    const paletteOffset = readU32(view, paletteTable + 4 + paletteIndex * 4);
    if (paletteOffset + 516 > bytes.byteLength) throw new Error(`VRP palette ${paletteIndex} is truncated`);
    const colors = new Uint16Array(256);
    for (let color = 0;color < colors.length;color += 1) colors[color] = view.getUint16(paletteOffset + 4 + color * 2, true);
    palettes.push(colors);
  }

  const spriteCount = readU32(view, spriteTable);
  const spriteOffsets = Array.from({ length: spriteCount }, (_, index) => readU32(view, spriteTable + 4 + index * 4));
  const sprites = spriteOffsets.map((offset, index) => {
    const end = spriteOffsets[index + 1] ?? spriteDataEnd;
    return decodeSprite(view, offset, end, palettes, index);
  });

  const animationTable = readU32(view, 16);
  const animationCount = readU32(view, animationTable);
  const animations = Array.from({ length: animationCount }, (_, index) => {
    const offset = readU32(view, animationTable + 4 + index * 4);
    if (offset === 0) return undefined;
    try {
      return decodeAnimation(view, offset, index);
    } catch {
      // Some shipped VRPs leave non-zero garbage pointers in unused animation
      // slots. The native resource loader treats those slots as absent.
      return undefined;
    }
  });
  return { sprites, animations };
};

const decodeAnimation = (view: DataView, offset: number, animationIndex: number): VrpAnimation => {
  if (offset + 12 > view.byteLength) throw new Error(`VRP animation ${animationIndex} header is truncated`);
  const durationTicks = readU32(view, offset);
  const firstFrame = readU32(view, offset + 4);
  const durationMilliseconds = (durationTicks * 1000) / 65536;
  const frameCount = readU32(view, offset + 8);
  if (offset + 12 + frameCount * 4 > view.byteLength) throw new Error(`VRP animation ${animationIndex} frame table is truncated`);
  const frames = Array.from({ length: frameCount }, (_, frameIndex) => {
    const frameOffset = readU32(view, offset + 12 + frameIndex * 4);
    if (frameOffset + 8 > view.byteLength) throw new Error(`VRP animation ${animationIndex} frame ${frameIndex} is truncated`);
    const objectCount = view.getInt16(frameOffset, true);
    const objectOffset = readU32(view, frameOffset + 4);
    if (objectOffset + objectCount * 20 > view.byteLength) throw new Error(`VRP animation ${animationIndex} frame ${frameIndex} objects are truncated`);
    const objects = Array.from({ length: objectCount }, (_, objectIndex): VrpObject => {
      const object = objectOffset + objectIndex * 20;
      const topFixed = view.getInt16(object + 18, true);
      const bottomFixed = view.getInt16(object + 16, true);
      return {
        sprite: readU32(view, object),
        // The native renderer at 0x125e44 reads both fields with LDRSH.
        scaleX: view.getInt16(object + 4, true) / OBJECT_SCALE_ONE,
        scaleY: view.getInt16(object + 6, true) / OBJECT_SCALE_ONE,
        drawMode: view.getUint8(object + 8),
        effect: view.getUint8(object + 9) & 0x1f,
        rotation: view.getInt16(object + 10, true),
        left: view.getInt16(object + 12, true) / 16,
        right: view.getInt16(object + 14, true) / 16,
        top: -topFixed / 16,
        bottom: -bottomFixed / 16,
      };
    });
    const markerCount = view.getInt16(frameOffset + 2, true);
    const markerOffset = readU32(view, frameOffset + 8);
    const markers = Array.from({ length: markerCount }, (_, index) => {
      const at = markerOffset + index * 8;
      return { id: view.getInt16(at + 6, true), x: view.getInt16(at + 2, true) / 16, y: -view.getInt16(at + 4, true) / 16 };
    });
    return { objects, markers };
  });
  return { firstFrame, durationTicks, durationMilliseconds, frames };
};

/** Semantic translation of the player at 0x125b9c / 0x125d6c. */
export class VrpPlayer {
  frame = 0;
  position = 0;
  constructor(readonly archive: VrpArchive, public animation: number, public looping = true) { }

  select(animation: number, looping = true): void {
    this.animation = animation;
    this.looping = looping;
    this.position = 0;
    this.frame = 0;
  }

  update(milliseconds: number): boolean {
    const animation = this.archive.animations[this.animation];
    if (!animation || !animation.frames.length || !animation.durationTicks) return true;
    this.position += Math.floor(milliseconds * 65536 / 1000);
    const complete = this.position > animation.durationTicks;
    if (complete) this.position = this.looping ? this.position - animation.durationTicks : animation.durationTicks;
    this.frame = Math.min(animation.firstFrame + animation.frames.length - 1,
      Math.floor(this.position * (animation.firstFrame + animation.frames.length) / animation.durationTicks));
    return complete;
  }

  draw(target: Rgb565Framebuffer, x = 0, originY = target.height, scaleY = 1): void {
    const animation = this.archive.animations[this.animation];
    if (animation) drawVrpFrameBottomUp(target, this.archive, this.animation, this.frame - animation.firstFrame, x, originY, scaleY);
  }
}

const decodeSprite = (
  view: DataView,
  offset: number,
  end: number,
  palettes: readonly Uint16Array[],
  spriteIndex: number,
): VrpSprite => {
  if (offset + 16 > end || end > view.byteLength) throw new Error(`VRP sprite ${spriteIndex} header is truncated`);
  const width = readU32(view, offset + 4);
  const height = readU32(view, offset + 8);
  const paletteIndex = readU32(view, offset + 12);
  const palette = palettes[paletteIndex];
  if (!palette) throw new Error(`VRP sprite ${spriteIndex} uses missing palette ${paletteIndex}`);

  const pixels = new Uint16Array(width * height);
  const opaque = new Uint8Array(width * height);
  const runs: { skip: number; length: number }[][] = [];
  let cursor = offset + 16;
  for (let y = 0;y < height;y += 1) {
    const row: { skip: number; length: number }[] = [];
    runs.push(row);
    let x = 0;
    while (x < width) {
      if (cursor + 2 > end) throw new Error(`VRP sprite ${spriteIndex} row ${y} is truncated`);
      const transparent = view.getUint8(cursor);
      const literal = view.getUint8(cursor + 1);
      row.push({ skip: transparent, length: literal });
      cursor += 2;
      x += transparent;
      if (x + literal > width || cursor + literal > end) throw new Error(`VRP sprite ${spriteIndex} row ${y} is invalid`);
      for (let count = 0;count < literal;count += 1) {
        const destination = y * width + x;
        pixels[destination] = palette[view.getUint8(cursor)];
        opaque[destination] = 1;
        cursor += 1;
        x += 1;
      }
      if (transparent === 0 && literal === 0) throw new Error(`VRP sprite ${spriteIndex} row ${y} does not advance`);
    }
  }
  return { width, height, pixels, opaque, runs };
};

export const drawVrpFrameBottomUp = (
  target: Rgb565Framebuffer,
  archive: VrpArchive,
  animationIndex: number,
  frameIndex: number,
  offsetX = 0,
  originY = target.height,
  scaleY = 1,
): void => {
  const animation = archive.animations[animationIndex];
  const frame = animation?.frames[frameIndex];
  if (!frame) return;
  for (const object of frame.objects) {
    const sprite = archive.sprites[object.sprite];
    if (!sprite) throw new Error(`VRP animation ${animationIndex} uses missing sprite ${object.sprite}`);
    const left = object.left + offsetX;
    const right = object.right + offsetX;
    const top = originY - object.bottom * scaleY;
    const bottom = originY - object.top * scaleY;
    const startX = Math.floor(object.scaleX >= 0 ? left : right);
    const startY = Math.floor(object.scaleY >= 0 ? top : bottom);
    target.blitTransformed(
      sprite,
      startX,
      startY,
      object.scaleX,
      object.scaleY * scaleY,
      (object.rotation * Math.PI * 2) / OBJECT_ROTATION_TURN,
      blendMode(object),
      object.effect,
    );
  }
};
