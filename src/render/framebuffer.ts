export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export class Framebuffer {
  static readonly WIDTH = 32;
  static readonly HEIGHT = 16;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width = Framebuffer.WIDTH, height = Framebuffer.HEIGHT) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("Framebuffer dimensions must be positive integers.");
    }
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
  }

  setPixel(x: number, y: number, r: number, g: number, b: number): void {
    const offset = this.#offset(x, y);
    this.data[offset] = clampByte(r);
    this.data[offset + 1] = clampByte(g);
    this.data[offset + 2] = clampByte(b);
  }

  getPixel(x: number, y: number): Rgb {
    const offset = this.#offset(x, y);
    return {
      r: this.data[offset] ?? 0,
      g: this.data[offset + 1] ?? 0,
      b: this.data[offset + 2] ?? 0,
    };
  }

  fill(r: number, g: number, b: number): void {
    const color = [clampByte(r), clampByte(g), clampByte(b)] as const;
    for (let offset = 0; offset < this.data.length; offset += 3) this.data.set(color, offset);
  }

  clear(): void {
    this.data.fill(0);
  }

  #offset(x: number, y: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new RangeError(`Pixel (${x}, ${y}) is outside ${this.width}x${this.height}`);
    }
    return (y * this.width + x) * 3;
  }
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}
