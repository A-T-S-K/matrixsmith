import { describe, expect, it, vi } from "vitest";
import {
  TraceRecorder,
  serializeTraceEvent,
} from "../../src/diagnostics/trace";
import { INPUT_LIMITS } from "../../src/application/input-limits";

const cap = INPUT_LIMITS.traceEvents;
const value = (index: number) => ({
  timestamp: "2026-10-03T12:00:00.000Z",
  type: "gatt.read",
  metadata: { index, text: "unchanged", flag: false, empty: null },
  rawHex: "00aBFF",
});
const batch = (count: number, start = 0) =>
  Array.from({ length: count }, (_, i) => value(i + start));

describe("serialized trace contract", () => {
  it.each([0, 3, cap, cap + 101])(
    "appends %i records in input order with bounded valid retention and a live view",
    (count) => {
      const trace = new TraceRecorder();
      const first = trace.record("error", { index: -1 });
      const live = trace.events;
      const incoming = batch(count);
      trace.importSerialized(incoming);
      const expected = [-1, ...incoming.map((e) => e.metadata.index)].slice(
        -cap,
      );
      expect(trace.events).toBe(live);
      expect(live.map((e) => e.metadata.index)).toEqual(expected);
      expect(trace.revision).toBe(count + 1);
      if (count < cap) expect(live[0]).toBe(first);
      expect(new Set(live).size).toBe(live.length);
      expect(live.at(-1)?.timestamp).toBe(
        count ? value(0).timestamp : first.timestamp,
      );
    },
  );

  it("counts accepted records, retains the last valid tail and preserves duplicate identities", () => {
    const trace = new TraceRecorder();
    trace.importSerialized(batch(cap));
    const survivor = trace.events[100]!;
    trace.importSerialized(batch(100, cap));
    expect(trace.events[0]).toBe(survivor);
    const incoming = batch(cap + 10).flatMap((e) => [
      { ...e, metadata: [] },
      e,
      { ...e, timestamp: 3 },
      { ...e, type: null },
    ]);
    trace.importSerialized(incoming);
    expect(trace.events.map((e) => e.metadata.index)).toEqual(
      batch(cap + 10)
        .map((e) => e.metadata.index)
        .slice(-cap),
    );
    expect(trace.revision).toBe(cap * 2 + 110);
  }, 30000);

  it("preserves raw/metadata values, omits malformed hex without rejecting the record", () => {
    const trace = new TraceRecorder();
    const hexes = ["00aBFF", "", "abc", "gg", "0x12", "00 12"];
    trace.importSerialized(hexes.map((rawHex, i) => ({ ...value(i), rawHex })));
    expect([...trace.events[0]!.rawBytes!]).toEqual([0, 171, 255]);
    expect(trace.events[1]!.rawBytes).toEqual(new Uint8Array());
    for (const event of trace.events.slice(2))
      expect(event.rawBytes).toBeUndefined();
    expect(trace.events.map((e) => e.metadata)).toEqual(
      hexes.map((_, i) => value(i).metadata),
    );
    expect(serializeTraceEvent(trace.events[0]!)).toEqual({
      ...value(0),
      rawHex: "00ABFF",
    });
    const bytes = Uint8Array.of(1);
    const recorded = trace.record("error", {}, bytes);
    bytes[0] = 2;
    expect(recorded.rawBytes![0]).toBe(1);
  });

  it("notifies per accepted event after trim/revision, in Set order including additions/removals", () => {
    const trace = new TraceRecorder();
    trace.importSerialized(batch(cap));
    const seen: string[] = [];
    const late = () => seen.push("late");
    let remove = () => {};
    trace.subscribe((event) => {
      seen.push(`first:${event.metadata.index}`);
      expect(trace.events).toHaveLength(cap);
      expect(trace.events.at(-1)).toBe(event);
      expect(trace.revision).toBe(cap + Number(event.metadata.index) + 1);
      remove();
      trace.subscribe(late);
    });
    remove = trace.subscribe(() => seen.push("removed"));
    trace.importSerialized([value(0), { ...value(8), metadata: [] }, value(1)]);
    expect(seen).toEqual(["first:0", "late", "first:1", "late"]);
  });

  it("retains nested record/import ordering and resumes the outer listener iteration", () => {
    const trace = new TraceRecorder();
    const seen: string[] = [];
    trace.subscribe((event) => {
      seen.push(`a:${event.metadata.index}`);
      if (event.metadata.index === 0) {
        trace.record("error", { index: 10 });
        trace.importSerialized([value(11)]);
      }
    });
    trace.subscribe((event) => seen.push(`b:${event.metadata.index}`));
    trace.importSerialized([value(0), value(1)]);
    expect(seen).toEqual([
      "a:0",
      "a:10",
      "b:10",
      "a:11",
      "b:11",
      "b:0",
      "a:1",
      "b:1",
    ]);
    expect(trace.events.map((e) => e.metadata.index)).toEqual([0, 10, 11, 1]);
    expect(trace.revision).toBe(4);
  });

  it("propagates listener exceptions with committed partial progress and stops subsequent listeners", () => {
    const trace = new TraceRecorder();
    trace.importSerialized(batch(cap));
    trace.subscribe(() => {
      throw Error("listener failure");
    });
    let called = false;
    trace.subscribe(() => {
      called = true;
    });
    expect(() =>
      trace.importSerialized([value(100000), value(100001)]),
    ).toThrow("listener failure");
    expect(trace.events).toHaveLength(cap);
    expect(trace.events[0]!.metadata.index).toBe(1);
    expect(trace.events.at(-1)!.metadata.index).toBe(100000);
    expect(trace.revision).toBe(cap + 1);
    expect(called).toBe(false);
  });

  it("preserves accessor-visible live retention and throwing input partial progress", () => {
    const trace = new TraceRecorder();
    trace.importSerialized(batch(cap));
    const live = trace.events;
    const accessor = {
      ...value(1),
      get rawHex(): string {
        expect(live).toHaveLength(cap);
        expect(live.at(-1)!.metadata.index).toBe(100000);
        throw Error("input failure");
      },
    };
    expect(() =>
      trace.importSerialized([value(100000), accessor, value(2)]),
    ).toThrow("input failure");
    expect(trace.revision).toBe(cap + 1);
    expect(live[0]!.metadata.index).toBe(1);
  });

  it("honors reentrant input subscription and self-unsubscribe", () => {
    const trace = new TraceRecorder();
    trace.importSerialized(batch(cap));
    const seen: number[] = [];
    let remove = () => {};
    let subscribed = false;
    const accessor = {
      ...value(1),
      get rawHex() {
        if (!subscribed) {
          subscribed = true;
          remove = trace.subscribe((event) => {
            seen.push(Number(event.metadata.index));
            remove();
          });
        }
        return "01";
      },
    };
    trace.importSerialized([value(0), accessor, value(2)]);
    expect(seen).toEqual([1]);
    expect(trace.revision).toBe(cap + 3);
  });
});

it("owns imported scalar metadata and bytes independently of a frozen source and another recorder", () => {
  const source = Object.freeze({
    ...value(0),
    metadata: Object.freeze(value(0).metadata),
  });
  const a = new TraceRecorder();
  const b = new TraceRecorder();
  // Exercise both paths; imported ownership is independent of subscriptions.
  b.subscribe(() => {});
  a.importSerialized([source]);
  b.importSerialized([source]);
  expect(a.events[0]!.metadata).not.toBe(source.metadata);
  expect(a.events[0]!.metadata).not.toBe(b.events[0]!.metadata);
  Object.assign(a.events[0]!.metadata, { index: 99 });
  a.events[0]!.rawBytes![0] = 99;
  expect(source.metadata.index).toBe(0);
  expect(b.events[0]!.metadata.index).toBe(0);
  expect(b.events[0]!.rawBytes![0]).toBe(0);
});

it("keeps sparse/custom iterable and accessor metadata inputs on the sequential contract", () => {
  const trace = new TraceRecorder();
  const sparse = [value(0), value(1), value(2)];
  delete sparse[1];
  expect(() => trace.importSerialized(sparse)).toThrow();
  expect(trace.revision).toBe(1);
  const values = [value(3)];
  Object.assign(values, {
    [Symbol.iterator]: function* () {
      yield value(4);
      yield value(5);
    },
  });
  trace.importSerialized(values);
  expect(trace.events.map((e) => e.metadata.index)).toEqual([0, 4, 5]);
  const event = {
    ...value(6),
    metadata: {
      get index() {
        return trace.revision;
      },
    },
  };
  trace.importSerialized([event]);
  expect(trace.events.at(-1)!.metadata.index).toBe(3);
});

it("bounds retained decoding and compacts once while preserving the live array", () => {
  const trace = new TraceRecorder();
  trace.importSerialized(batch(cap));
  const live = trace.events;
  const shift = vi.spyOn(live as unknown as unknown[], "shift");
  const splice = vi.spyOn(live as unknown as unknown[], "splice");
  const decode = vi.spyOn(Uint8Array, "from");
  try {
    const incoming = batch(cap + 101).flatMap((e) => [
      e,
      { ...e, metadata: [] },
    ]);
    trace.importSerialized(incoming);
    expect(live.map((e) => e.metadata.index)).toEqual(
      batch(cap + 101)
        .map((e) => e.metadata.index)
        .slice(-cap),
    );
    expect(shift).not.toHaveBeenCalled();
    expect(splice).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(cap);
    expect(trace.revision).toBe(cap * 2 + 101);
  } finally {
    shift.mockRestore();
    splice.mockRestore();
    decode.mockRestore();
  }
});

it("keeps direct recorder acceptance and timestamp order without normalizing malformed values", () => {
  const trace = new TraceRecorder();
  const records = [
    {
      ...value(0),
      timestamp: "later",
      type: "unknown.serialized.type",
      metadata: { finite: 1, unusual: Number.NaN },
      rawHex: 1,
    },
    { ...value(1), timestamp: "earlier", rawHex: "0G" },
  ];
  trace.importSerialized(records);
  expect(trace.events.map((e) => e.timestamp)).toEqual(["later", "earlier"]);
  expect(trace.events[0]!.type).toBe("unknown.serialized.type");
  expect(trace.events[0]!.metadata.unusual).toBeNaN();
  expect(trace.events.every((e) => e.rawBytes === undefined)).toBe(true);
});

it("keeps arrays with custom methods on the original iterator path", () => {
  const trace = new TraceRecorder();
  trace.importSerialized(batch(cap));
  const values = batch(1, cap);
  const callback = vi.fn(() => {
    throw Error("custom array method must not run");
  });
  Object.assign(values, { every: callback, filter: callback });
  trace.importSerialized(values);
  expect(callback).not.toHaveBeenCalled();
  expect(trace.events.at(-1)!.metadata.index).toBe(cap);
  expect(trace.revision).toBe(cap + 1);
});
