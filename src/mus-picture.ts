/** Embedded picture decoder, translated from 0x1059e8 (NRV2B). */
export function musPicture(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const start = view.getUint32(0, true) + 4;
  if (view.getUint32(start, true) !== 0xab0c0de0) throw new Error("Invalid MUS picture");
  const output = new Uint8Array(view.getUint32(start + 4, true));
  let input = start + 12, cursor = 0, bits = 0, lastOffset = 1;
  const byte = () => {
    if (input >= data.length) throw new Error("Truncated MUS picture");
    return data[input++];
  };
  const bit = () => {
    bits = (bits & 0x7f) ? bits * 2 : byte() * 2 + 1;
    return (bits >>> 8) & 1;
  };
  while (cursor < output.length) {
    if (bit()) { output[cursor++] = byte(); continue; }
    let offset = 1;
    do { offset = offset * 2 + bit(); } while (!bit());
    if (offset === 2) offset = lastOffset;
    else {
      offset = (offset - 3) * 256 + byte();
      if (offset === 0xffffffff) break;
      lastOffset = ++offset;
    }
    let length = bit() * 2 + bit();
    if (!length) {
      length = 1;
      do { length = length * 2 + bit(); } while (!bit());
      length += 2;
    }
    if (offset > 0xd00) length++;
    length++;
    if (offset > cursor || cursor + length > output.length) throw new Error("Invalid MUS picture back reference");
    while (length--) { output[cursor] = output[cursor - offset]; cursor++; }
  }
  return output;
}
