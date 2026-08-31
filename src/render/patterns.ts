import { Framebuffer } from "./framebuffer";

export function orientationPattern(): Framebuffer {
  const frame = new Framebuffer();
  frame.clear();

  for (let x = 0; x < frame.width; x += 1) {
    frame.setPixel(x, 7, 48, 48, 48);
    if (x % 4 === 0) frame.setPixel(x, 8, 255, 180, 0);
  }
  for (let y = 0; y < frame.height; y += 1) {
    frame.setPixel(15, y, 48, 48, 48);
    if (y % 4 === 0) frame.setPixel(16, y, 0, 220, 255);
  }

  paintCorner(frame, 0, 0, 255, 0, 0);
  paintCorner(frame, frame.width - 3, 0, 0, 255, 0);
  paintCorner(frame, 0, frame.height - 3, 0, 0, 255);
  paintCorner(frame, frame.width - 3, frame.height - 3, 255, 255, 255);
  return frame;
}

function paintCorner(frame: Framebuffer, startX: number, startY: number, r: number, g: number, b: number): void {
  for (let y = startY; y < startY + 3; y += 1) {
    for (let x = startX; x < startX + 3; x += 1) frame.setPixel(x, y, r, g, b);
  }
}
