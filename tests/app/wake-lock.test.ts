import { describe, expect, it, vi } from "vitest";
import { TransferWakeLock, type WakeLockHandle } from "../../src/app/wake-lock";

describe("transfer wake lock", () => {
  it("acquires and releases without owning transfer success", async () => {
    const release = vi.fn(async () => undefined); const handle: WakeLockHandle = { release };
    const request = vi.fn(async () => handle); const lock = new TransferWakeLock({ wakeLock: { request } });
    expect(await lock.acquire()).toBe(true); expect(request).toHaveBeenCalledWith("screen");
    await lock.release(); expect(release).toHaveBeenCalledOnce();
  });

  it("treats unsupported or rejected requests as non-fatal", async () => {
    expect(await new TransferWakeLock({}).acquire()).toBe(false);
    const lock = new TransferWakeLock({ wakeLock: { request: async () => { throw new Error("denied"); } } });
    await expect(lock.acquire()).resolves.toBe(false); await expect(lock.release()).resolves.toBeUndefined();
  });

  it("reacquires after visibility returns when the browser releases it", async () => {
    let released: (() => void) | undefined; const listeners = new Map<string, EventListenerOrEventListenerObject>();
    const documentLike = { visibilityState: "visible" as DocumentVisibilityState, addEventListener: (_: string, fn: EventListenerOrEventListenerObject): void => { listeners.set("visibilitychange", fn); }, removeEventListener: (): void => undefined };
    const request = vi.fn(async () => ({ release: async () => undefined, addEventListener: (_: "release", fn: () => void) => { released = fn; } }));
    const lock = new TransferWakeLock({ wakeLock: { request } }, documentLike); await lock.acquire(); released?.(); const listener = listeners.get("visibilitychange"); if (typeof listener === "function") listener(new Event("visibilitychange"));
    await Promise.resolve(); expect(request).toHaveBeenCalledTimes(2); await lock.release();
  });
});
