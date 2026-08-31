import { Framebuffer } from "../render/framebuffer";

const PREFIX = "iledhat:preset:";

export function savePreset(name: string, frame: Framebuffer): void {
  const key = normalizedName(name);
  localStorage.setItem(`${PREFIX}${key}`, JSON.stringify([...frame.data]));
}

export function loadPreset(name: string): Framebuffer | null {
  const raw = localStorage.getItem(`${PREFIX}${normalizedName(name)}`);
  if (!raw) return null;
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length !== Framebuffer.WIDTH * Framebuffer.HEIGHT * 3) return null;
  if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return null;
  const frame = new Framebuffer();
  frame.data.set(values as number[]);
  return frame;
}

function normalizedName(name: string): string {
  const value = name.trim();
  if (!value) throw new Error("Preset name cannot be empty.");
  return encodeURIComponent(value.slice(0, 80));
}
