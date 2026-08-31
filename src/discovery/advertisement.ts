export { parseAdvertisement, type AdStructure } from "../ble/advertisement";
import { parseAdvertisement, type AdStructure } from "../ble/advertisement";

export interface AdvertisementFacts {
  readonly flags?: number;
  readonly serviceUuids16: readonly string[];
  readonly localName?: string;
  readonly manufacturerDataHex?: string;
  readonly manufacturerCompanyFieldHex?: string;
}

export function extractAdvertisementFacts(bytes: Uint8Array): AdvertisementFacts {
  const structures = parseAdvertisement(bytes);
  const flags = find(structures, 0x01)?.data[0];
  const serviceData = [...structures.filter(({ type }) => type === 0x02 || type === 0x03).flatMap(({ data }) => [...data])];
  const serviceUuids16: string[] = [];
  for (let index = 0; index + 1 < serviceData.length; index += 2) {
    const low = serviceData[index] ?? 0;
    const high = serviceData[index + 1] ?? 0;
    serviceUuids16.push((low | (high << 8)).toString(16).padStart(4, "0").toUpperCase());
  }
  const nameData = find(structures, 0x09)?.data ?? find(structures, 0x08)?.data;
  const manufacturer = find(structures, 0xff)?.data;
  return {
    ...(flags !== undefined ? { flags } : {}),
    serviceUuids16,
    ...(nameData ? { localName: new TextDecoder().decode(nameData) } : {}),
    ...(manufacturer ? { manufacturerDataHex: toCompactHex(manufacturer) } : {}),
    ...(manufacturer && manufacturer.length >= 2 ? { manufacturerCompanyFieldHex: toCompactHex(manufacturer.slice(0, 2)) } : {}),
  };
}

export function parseHexBytes(hex: string): Uint8Array {
  const compact = hex.replaceAll(/\s/g, "");
  if (compact.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(compact)) throw new Error("Hex input must contain complete byte pairs.");
  return Uint8Array.from(compact.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function find(structures: readonly AdStructure[], type: number): AdStructure | undefined { return structures.find((item) => item.type === type); }
function toCompactHex(bytes: Uint8Array): string { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase(); }
