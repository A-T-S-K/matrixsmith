import { Framebuffer } from "../render/framebuffer";
import { BrowserStorageRepository, type KeyValueStorage } from "./repository";

const PREFIX = "matrixsmith:v1:preset:";
const LEGACY_PREFIX = "iledhat:preset:";

export interface PresetRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly pixelFormat: "RGB888";
  readonly data: readonly number[];
  readonly profileId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function savePreset(name: string, frame: Framebuffer, profileId?: string, storage?: KeyValueStorage): void {
  const key = normalizedName(name);
  const repository = new BrowserStorageRepository(storage);
  const now = new Date().toISOString();
  const existing = parseRecord(repository.get(`${PREFIX}${key}`));
  const record: PresetRecord = {
    schemaVersion: 1, id: key, name: name.trim(), width: frame.width, height: frame.height,
    pixelFormat: "RGB888", data: [...frame.data], ...(profileId ? { profileId } : {}),
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  repository.set(`${PREFIX}${key}`, JSON.stringify(record));
}

export function loadPreset(name: string, storage?: KeyValueStorage): Framebuffer | null {
  const key = normalizedName(name);
  const repository = new BrowserStorageRepository(storage);
  const record = parseRecord(repository.get(`${PREFIX}${key}`));
  if (record) return frameFromRecord(record);
  const legacy = parseLegacy(repository.get(`${LEGACY_PREFIX}${key}`));
  if (!legacy) return null;
  const frame = new Framebuffer(32, 16);
  frame.data.set(legacy);
  return frame;
}

function frameFromRecord(record: PresetRecord): Framebuffer | null {
  if (record.data.length !== record.width * record.height * 3) return null;
  const frame = new Framebuffer(record.width, record.height);
  frame.data.set(record.data);
  return frame;
}

function parseRecord(raw: string | null): PresetRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || value.schemaVersion !== 1 || typeof value.id !== "string" || typeof value.name !== "string") return null;
    if (!positiveInteger(value.width) || !positiveInteger(value.height) || value.pixelFormat !== "RGB888") return null;
    if (!validBytes(value.data) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;
    return value as unknown as PresetRecord;
  } catch { return null; }
}

function parseLegacy(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return validBytes(value) && value.length === 32 * 16 * 3 ? value : null;
  } catch { return null; }
}

function validBytes(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);
}

function positiveInteger(value: unknown): value is number { return Number.isInteger(value) && (value as number) > 0; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function normalizedName(name: string): string {
  const value = name.trim();
  if (!value) throw new Error("Preset name cannot be empty.");
  return encodeURIComponent(value.slice(0, 80));
}
