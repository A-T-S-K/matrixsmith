import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  compileOfflineExample,
  type OfflineExample,
} from "../../app/offline-catalog";
import type { OfflineCompilation } from "../../application/offline-compilation";
import { BrowserFilesAdapter } from "../../adapters/files/browser-files";
import { FramePreview } from "../components/FramePreview";
import type { KnowledgeSource } from "../../knowledge/types";
const files = new BrowserFilesAdapter();
export function OfflineLegacy(): JSX.Element {
  const [example, setExample] = useState<OfflineExample>("blank");
  const [result, setResult] = useState<OfflineCompilation | null>(() =>
    compileOfflineExample("blank"),
  );
  const [packetIndex, setPacketIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [copyFailure, setCopyFailure] = useState<"packet" | "all" | null>(null);
  const [sources, setSources] = useState<readonly KnowledgeSource[] | null>(
    null,
  );
  const [sourceError, setSourceError] = useState("");
  const generation = useRef(0);
  const active = useRef(true);
  useEffect(
    () => () => {
      active.current = false;
      generation.current++;
    },
    [],
  );
  const clearCopy = () => {
    generation.current++;
    setStatus("");
    setCopyFailure(null);
  };
  const compile = (next: OfflineExample) => {
    clearCopy();
    setResult(null);
    setError(null);
    setPacketIndex(0);
    setExample(next);
    try {
      setResult(compileOfflineExample(next));
    } catch (reason) {
      setError(String(reason));
    }
  };
  const copy = async (kind: "packet" | "all") => {
    if (!result) return;
    const token = ++generation.current;
    setCopyFailure(null);
    setStatus("Copying planned bytes…");
    const text =
      kind === "all"
        ? result.plan.packets.map((p) => p.hex).join("\n")
        : result.plan.packets[packetIndex]!.hex;
    let copied: boolean;
    try {
      copied = await files.copyText(text);
    } catch {
      copied = false;
    }
    if (!active.current || token !== generation.current) return;
    setStatus(copied ? "Exact planned bytes copied." : "");
    setCopyFailure(copied ? null : kind);
  };
  const loadSources = async () => {
    setSourceError("");
    try {
      const { loadKnowledge } = await import("../../knowledge/load");
      const corpus = await loadKnowledge();
      if (active.current)
        setSources(
          corpus.sources.filter((s) =>
            [
              "file-fossasia-badgemagic-firmware-BadgeBLE-md",
              "src-fossasia-badgemagic-firmware",
              "src-fossasia-badgemagic-app",
            ].includes(s.id),
          ),
        );
    } catch {
      if (active.current)
        setSourceError(
          "Source detail is unavailable. You can retry; planned bytes are still available.",
        );
    }
  };
  const packet = result?.plan.packets[packetIndex];
  return (
    <main class="offline-legacy">
      <a href={import.meta.env.BASE_URL}>← MatrixSmith home</a>
      <p class="eyebrow">OFFLINE COMPILATION</p>
      <h1>LSLED legacy preview</h1>
      <p>
        Compile an authored 44×11 monochrome example without a device. This
        logical preview does not prove badge rendering or accepted device
        support.
      </p>
      <label>
        Example{" "}
        <select
          value={example}
          onChange={(event) =>
            compile(event.currentTarget.value as OfflineExample)
          }
        >
          <option value="blank">Blank</option>
          <option value="asymmetric">Asymmetric markers</option>
          <option value="checkerboard">Checkerboard</option>
        </select>
      </label>
      {error && (
        <div role="alert">
          <p>Compilation failed: {error}</p>
          <button onClick={() => compile(example)}>Retry compilation</button>
        </div>
      )}
      {result && (
        <>
          <section aria-label="Logical pixels">
            <h2>Logical pixels</h2>
            <FramePreview
              frame={result.preview}
              label={`${example} logical monochrome pixels, 44 columns and 11 rows`}
            />
            <p>One bank · fixed mode · no flashing or marquee.</p>
          </section>
          <section aria-label="Planned transfer bytes">
            <h2>Planned transfer bytes</h2>
            <p>
              64-byte header + 66-byte bitmap = 130-byte program. 14 zero
              padding bytes. 9 packets × 16 bytes = 144 planned bytes. No actual
              TX evidence.
            </p>
            <label>
              Packet index{" "}
              <select
                value={packetIndex}
                onChange={(event) => {
                  clearCopy();
                  setPacketIndex(Number(event.currentTarget.value));
                }}
              >
                {result.plan.packets.map((p) => (
                  <option key={p.index} value={p.index}>
                    {p.index} · offsets {p.index * 16}–{p.index * 16 + 15}
                  </option>
                ))}
              </select>
            </label>
            {packet && (
              <div class="offline-packet">
                <p>
                  Service <code>{packet.endpoint.serviceUuid}</code>
                  <br />
                  Characteristic{" "}
                  <code>{packet.endpoint.characteristicUuid}</code>
                </p>
                <p>
                  Modeled GATT write: {packet.writeMode}. Protocol
                  acknowledgement unknown.
                </p>
                <pre aria-label={`Exact planned packet ${packet.index}`}>
                  <code>{packet.hex}</code>
                </pre>
              </div>
            )}
            <div class="inline-form">
              <button onClick={() => void copy("packet")}>
                Copy packet bytes
              </button>
              <button onClick={() => void copy("all")}>
                Copy all planned bytes
              </button>
            </div>
            <p role="status" aria-live="polite">
              {status}
            </p>
            {copyFailure && (
              <div role="alert">
                <p>
                  Could not copy bytes. Retry or select the displayed exact hex.
                </p>
                <button onClick={() => void copy(copyFailure)}>
                  Retry copy
                </button>
              </div>
            )}
          </section>
          <details>
            <summary
              onClick={() => {
                if (!sources) void loadSources();
              }}
            >
              Reference, sources and firmware limitations
            </summary>
            <p>
              <strong>{result.reference.profile.name}</strong>
            </p>
            <p class="offline-identity">{result.definitionIdentity}</p>
            <p>
              Exact black/white input; no threshold, resize or crop.
              Eight-column groups use the most significant bit first. The last
              group has four unused low bits per row, set to zero. Unused banks
              and header padding are zero.
            </p>
            <p>
              Timestamp: six zero bytes, a deterministic offline policy. Its
              device meaning is uncertain. Timing, persistence, Read/Notify
              responses and acknowledgements remain unknown. A transfer would
              model program replacement; no live operation is offered.
            </p>
            <p>
              OEM LSLED notes describe FEE1 Read/Write/Notify; open-firmware
              legacy is write-only. F055 next-gen is separate and unsupported
              here. Names and shared UUIDs cannot identify firmware, chipset or
              compatible hardware.
            </p>
            <p>
              The original app differs in month encoding, aligned-length padding
              and bitmap preprocessing. This proof covers the documented fixed
              layout and group ordering, not whole-app equivalence. Firmware
              README hardware observations are author reports, not evidence
              about your device.
            </p>
            <p>
              Inspected firmware revision:
              b2137f083bc24e212fe6281b53b26c1d511cd9b0. App
              encoder/converters/tests revision:
              69377e7e97458e541d8bebd58793ad20833dfeb9. Independently authored
              bit-string vectors; no upstream fonts or assets.
            </p>
            {sources ? (
              <ul>
                {sources.map((source) => (
                  <li key={source.id}>
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.id}
                      </a>
                    ) : (
                      source.id
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Source citations load on demand.</p>
            )}
            {sourceError && (
              <div role="alert">
                <p>{sourceError}</p>
                <button onClick={() => void loadSources()}>
                  Retry source detail
                </button>
              </div>
            )}
          </details>
        </>
      )}
    </main>
  );
}
