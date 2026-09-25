import { describe, expect, it } from "vitest";
import {
  buildAnnouncePacket,
  buildDataChunkPackets,
  crc32Custom,
  lzssCompress,
  lzssCompressSafe,
  lzssDecompress,
  UX_PACKAGE_SIZE,
  xorAll,
} from "../../src/drivers/coolledux/wire";
import { decodeEnvelope } from "../../src/drivers/coolled/common/envelope";
import conformance from "../fixtures/coolledux/conformance.json";

const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("CoolLEDUX custom CRC32", () => {
  it.each(Object.entries(conformance.crc32))(
    "matches the pinned reference for %s",
    (_name, vector) => {
      expect(crc32Custom(fromHex(vector.inputHex))).toBe(vector.crc >>> 0);
    },
  );

  it("differs from standard CRC-32 (no final complement)", () => {
    // Standard CRC-32 of "123456789" is 0xCBF43926; the custom variant is not.
    expect(crc32Custom(new TextEncoder().encode("123456789"))).not.toBe(
      0xcbf43926,
    );
  });
});

describe("CoolLEDUX LZSS", () => {
  it.each(Object.entries(conformance.lzss))(
    "bit-matches the reference compressor for %s",
    (_name, vector) => {
      expect(toHex(lzssCompress(fromHex(vector.inputHex)))).toBe(
        vector.compressedHex,
      );
    },
  );

  it.each(Object.entries(conformance.lzss))(
    "bit-matches the reference safe compressor for %s",
    (_name, vector) => {
      expect(toHex(lzssCompressSafe(fromHex(vector.inputHex)))).toBe(
        vector.safeHex,
      );
    },
  );

  it.each(Object.entries(conformance.lzss))(
    "round-trips %s through the decoder",
    (_name, vector) => {
      const input = fromHex(vector.inputHex);
      expect(toHex(lzssDecompress(lzssCompress(input)))).toBe(vector.inputHex);
      expect(toHex(lzssDecompress(lzssCompressSafe(input)))).toBe(
        vector.inputHex,
      );
    },
  );

  it("decodes reference-produced streams identically", () => {
    for (const vector of Object.values(conformance.lzss)) {
      expect(toHex(lzssDecompress(fromHex(vector.compressedHex)))).toBe(
        vector.inputHex,
      );
      expect(toHex(lzssDecompress(fromHex(vector.safeHex)))).toBe(
        vector.inputHex,
      );
    }
  });

  it("handles empty input", () => {
    expect(lzssCompress(new Uint8Array(0))).toHaveLength(0);
    expect(lzssCompressSafe(new Uint8Array(0))).toHaveLength(0);
    expect(lzssDecompress(new Uint8Array(0))).toHaveLength(0);
  });

  it("compresses repetitive input below its original size and safe-encodes ~12.5% above it", () => {
    const repetitive = new Uint8Array(1000).fill(0x41);
    expect(lzssCompress(repetitive).length).toBeLessThan(repetitive.length / 4);
    const safe = lzssCompressSafe(repetitive);
    expect(safe.length).toBe(1000 + Math.ceil(1000 / 8));
  });
});

describe("program announce packet", () => {
  const vector = conformance.announce;

  it("matches the reference announce bytes exactly", () => {
    expect(
      toHex(
        buildAnnouncePacket(
          fromHex(vector.programHex),
          vector.index,
          vector.count,
          vector.showCount,
        ),
      ),
    ).toBe(vector.packetHex);
  });

  it("embeds CRC and uncompressed length big-endian after opcode 0x02", () => {
    const packet = buildAnnouncePacket(fromHex(vector.programHex), 0, 1, 1);
    const payload = decodeEnvelope(packet).payload;
    expect(payload[0]).toBe(0x02);
    const crc =
      ((payload[1]! << 24) |
        (payload[2]! << 16) |
        (payload[3]! << 8) |
        payload[4]!) >>>
      0;
    expect(crc).toBe(vector.crc >>> 0);
    const length =
      ((payload[5]! << 24) |
        (payload[6]! << 16) |
        (payload[7]! << 8) |
        payload[8]!) >>>
      0;
    expect(length).toBe(fromHex(vector.programHex).length);
    expect(payload.slice(9)).toEqual(Uint8Array.of(0, 1, 1));
  });
});

describe("program data chunks", () => {
  const vector = conformance.chunks;

  it("matches the reference chunk packets exactly", () => {
    const chunks = buildDataChunkPackets(
      fromHex(vector.compressedHex),
      vector.chunkSize,
    );
    expect(chunks.map((chunk) => toHex(chunk.packet))).toEqual(
      vector.packetsHex,
    );
  });

  it("encodes chunk metadata and XOR checksum per the layout", () => {
    const compressed = fromHex(vector.compressedHex);
    const chunks = buildDataChunkPackets(compressed, 128);
    for (const [index, chunk] of chunks.entries()) {
      const payload = decodeEnvelope(chunk.packet).payload;
      expect(payload[0]).toBe(0x03);
      expect(payload[1]).toBe(0x00); // reserved
      const total =
        ((payload[2]! << 24) |
          (payload[3]! << 16) |
          (payload[4]! << 8) |
          payload[5]!) >>>
        0;
      expect(total).toBe(compressed.length);
      expect((payload[6]! << 8) | payload[7]!).toBe(index);
      const length = (payload[8]! << 8) | payload[9]!;
      expect(length).toBe(chunk.length);
      const sub = payload.slice(1, payload.length - 1);
      expect(payload[payload.length - 1]).toBe(xorAll(sub));
    }
  });

  it("splits at 128 bytes and keeps the final partial chunk", () => {
    const compressed = new Uint8Array(300).map((_, index) => index & 0xff);
    const chunks = buildDataChunkPackets(compressed, UX_PACKAGE_SIZE);
    expect(chunks.map((chunk) => chunk.length)).toEqual([128, 128, 44]);
  });

  it("produces no chunks for empty compressed data, matching the reference", () => {
    expect(buildDataChunkPackets(new Uint8Array(0))).toHaveLength(0);
  });
});

describe("envelope escaping conformance", () => {
  it.each(Object.entries(conformance.envelope))(
    "matches the reference envelope for %s",
    async (_name, vector) => {
      const { encodeEnvelope } =
        await import("../../src/drivers/coolled/common/envelope");
      expect(toHex(encodeEnvelope(fromHex(vector.payloadHex)))).toBe(
        vector.packetHex,
      );
    },
  );
});
