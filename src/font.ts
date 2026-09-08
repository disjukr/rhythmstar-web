import { Rgb565Framebuffer } from "./framebuffer";

export class BitmapFont {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;

  constructor(bytes: Uint8Array) {
    if (bytes.byteLength < 380) throw new Error("FNT header is truncated");
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  draw(target: Rgb565Framebuffer, text: string, x: number, y: number, color: number, outline?: number): void {
    // 0x115de8 draws six complete text passes before the white fill.
    if (outline !== undefined) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]]) {
        this.draw(target, text, x + dx, y + dy, outline);
      }
    }
    let cursor = x;
    for (const character of text) {
      if (character === " ") {
        cursor += 8;
        continue;
      }
      const code = character.charCodeAt(0);
      if (code < 0x21 || code > 0x7e) throw new Error(`FNT character is unavailable: ${character}`);
      const glyph = this.#view.getUint32(4 + (code - 0x21) * 4, true);
      if (glyph + 12 > this.#bytes.byteLength) throw new Error(`FNT glyph is truncated: ${character}`);
      this.#drawGlyph(target, glyph, cursor, y, color);
      cursor += 8;
    }
  }

  #drawGlyph(target: Rgb565Framebuffer, glyph: number, x: number, y: number, color: number): void {
    for (let row = 0;row < 12;row += 1) {
      const bits = this.#bytes[glyph + row];
      for (let column = 0;column < 8;column += 1) {
        if ((bits & (1 << column)) !== 0) target.setPixel(x + column, y + row, color);
      }
    }
  }
}

/** Mixed KSC-5601/ASCII text box renderer at 0x11e5f0. */
export class GameFont {
  readonly #hangul: DataView;
  readonly #english: DataView;
  readonly #indices = new Map<string, number>();

  constructor(hangul: Uint8Array, english: Uint8Array) {
    this.#hangul = new DataView(hangul.buffer, hangul.byteOffset, hangul.byteLength);
    this.#english = new DataView(english.buffer, english.byteOffset, english.byteLength);
    const decoder = new TextDecoder("euc-kr");
    for (let index = 0;index < 51;index++) this.#indices.set(decoder.decode(new Uint8Array([0xa4, 0xa1 + index])), index);
    for (let index = 0;index < 2350;index++) {
      this.#indices.set(decoder.decode(new Uint8Array([0xb0 + Math.floor(index / 94), 0xa1 + index % 94])), 51 + index);
    }
  }

  draw(target: Rgb565Framebuffer, text: string, x: number, y: number, width: number, height: number, color = 0xffff, clip?: { x: number; y: number; width: number; height: number }): void {
    let cx = x;
    let cy = y;
    const initialColor = color;
    const source = text.replaceAll("\r\n", "\n").replaceAll("\\n", "\n");
    for (let i = 0;i < source.length;i++) {
      const char = source[i];
      if (char === "\r") {
        const code = source[++i];
        color = ({ D: 53203, E: 65491, F: 64716, B: 0x001f, R: 0xf800, g: 0x7bef, V: 0x9999, Y: 0xffe0, U: initialColor } as Record<string, number>)[code] ?? initialColor;
        continue;
      }
      if (char === "\n") { cx = x; cy += 14; continue; }
      const ascii = char.charCodeAt(0) < 128;
      const advance = ascii ? 8 : 12;
      if (cx + advance > x + width) { cx = x; cy += 14; }
      if (cy >= y + height) break;
      if (char !== " ") {
        const index = ascii ? char.charCodeAt(0) - 0x21 : this.#indices.get(char);
        if (index !== undefined && index >= 0) {
          const font = ascii ? this.#english : this.#hangul;
          const glyph = font.getUint32(4 + index * 4, true);
          for (let row = 0;row < 12 && cy + row < y + height;row++) {
            const bits = ascii ? font.getUint8(glyph + row) : font.getUint16(glyph + row * 2, true);
            for (let col = 0;col < advance;col++) if ((bits & (1 << col)) && (!clip || (cx + col >= clip.x && cx + col < clip.x + clip.width && cy + row >= clip.y && cy + row < clip.y + clip.height))) target.setPixel(cx + col, cy + row, color);
          }
        }
      }
      cx += advance;
    }
  }
}
