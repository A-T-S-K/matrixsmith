import type { Framebuffer } from "../../render/framebuffer";

/** Column-major R, G, B bit planes; the MSB represents the top pixel of each 8-pixel group. */
export function packCoolLedPixels(frame: Framebuffer): Uint8Array {
  if (frame.height % 8 !== 0) throw new RangeError("CoolLEDX frame height must be divisible by 8.");
  const bytesPerPlane = frame.width * (frame.height / 8);
  const output = new Uint8Array(bytesPerPlane * 3);
  for (let channel = 0; channel < 3; channel += 1) {
    let target = channel * bytesPerPlane;
    for (let x = 0; x < frame.width; x += 1) {
      for (let groupY = 0; groupY < frame.height; groupY += 8) {
        let packed = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const pixel = frame.getPixel(x, groupY + bit);
          const component = channel === 0 ? pixel.r : channel === 1 ? pixel.g : pixel.b;
          packed = (packed << 1) | (component > 127 ? 1 : 0);
        }
        output[target] = packed;
        target += 1;
      }
    }
  }
  return output;
}
