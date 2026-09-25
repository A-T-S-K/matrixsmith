import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function render(size, safeArea = false) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = safeArea ? 0.8 : 1;
  const offset = (size * (1 - scale)) / 2;
  const color = (hex) =>
    hex.match(/../g).map((part) => Number.parseInt(part, 16));
  const set = (x, y, hex) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const at = (Math.floor(y) * size + Math.floor(x)) * 4;
    const [r, g, b] = color(hex);
    rgba[at] = r;
    rgba[at + 1] = g;
    rgba[at + 2] = b;
    rgba[at + 3] = 255;
  };
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) set(x, y, "08111d");
  const circle = (cx, cy, radius, hex) => {
    for (let y = cy - radius; y <= cy + radius; y += 1)
      for (let x = cx - radius; x <= cx + radius; x += 1)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) set(x, y, hex);
  };
  const map = (value) => offset + (value / 512) * size * scale;
  for (const x of [128, 256, 384])
    circle(map(x), map(160), map(42) - offset, "67e8f9");
  for (const x of [128, 256, 384])
    circle(map(x), map(288), map(42) - offset, "f472b6");
  const lineRadius = map(16) - offset;
  for (let x = map(128); x <= map(384); x += 1)
    circle(x, map(408), lineRadius, "fde68a");
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1)
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(new URL("../public/icon-192.png", import.meta.url), render(192));
writeFileSync(new URL("../public/icon-512.png", import.meta.url), render(512));
writeFileSync(
  new URL("../public/icon-maskable-512.png", import.meta.url),
  render(512, true),
);
