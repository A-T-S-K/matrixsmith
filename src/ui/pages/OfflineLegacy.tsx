import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  loadOfflineEntry,
  offlineCatalog,
  findOfflineEntry,
  type OfflineEntry,
} from "../../app/offline-catalog";
import type { OfflineCompilation } from "../../application/offline-compilation";
import { BrowserFilesAdapter } from "../../adapters/files/browser-files";
import { FramePreview } from "../components/FramePreview";
import type { KnowledgeSource } from "../../knowledge/types";
const files = new BrowserFilesAdapter();
/** One inspector consumes entry-owned examples/descriptions, never protocol IDs. */
export function OfflineLegacy({
  initialReference,
}: {
  readonly initialReference: string;
}): JSX.Element {
  const [referenceId, setReferenceId] = useState(initialReference);
  const [entry, setEntry] = useState<OfflineEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [example, setExample] = useState("blank");
  const [result, setResult] = useState<OfflineCompilation | null>(null);
  const [packetIndex, setPacketIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [copyFailure, setCopyFailure] = useState<"packet" | "all" | null>(null);
  const [sources, setSources] = useState<readonly KnowledgeSource[] | null>(
    null,
  );
  const [sourceError, setSourceError] = useState("");
  const owner = useRef(0);
  const copyGeneration = useRef(0);
  const sourceGeneration = useRef(0);
  const active = useRef(true);
  useEffect(
    () => () => {
      active.current = false;
      owner.current++;
      copyGeneration.current++;
    },
    [],
  );
  const clearCopy = () => {
    copyGeneration.current++;
    setStatus("");
    setCopyFailure(null);
  };
  const compile = (implementation: OfflineEntry, next: string) => {
    clearCopy();
    setResult(null);
    setError(null);
    setPacketIndex(0);
    setExample(next);
    try {
      setResult(implementation.compile(next));
    } catch (reason) {
      setError(String(reason));
    }
  };
  const reset = () => {
    owner.current++;
    sourceGeneration.current++;
    clearCopy();
    setEntry(null);
    setResult(null);
    setError(null);
    setLoadError("");
    setSources(null);
    setSourceError("");
    setPacketIndex(0);
    setExample("blank");
  };
  useEffect(() => {
    const token = ++owner.current;
    setLoading(true);
    void loadOfflineEntry(referenceId)
      .then((implementation) => {
        if (!active.current || token !== owner.current) return;
        setEntry(implementation);
        setLoading(false);
        compile(implementation, implementation.examples[0]!.id);
      })
      .catch((reason) => {
        if (!active.current || token !== owner.current) return;
        setLoading(false);
        setLoadError(String(reason));
      });
  }, [referenceId]);
  const selectReference = (id: string) => {
    reset();
    setReferenceId(id);
    const url = new URL(location.href);
    url.searchParams.set("offline", "1");
    url.searchParams.set("reference", id);
    history.replaceState(null, "", url);
  };
  const copy = async (kind: "packet" | "all") => {
    if (!result) return;
    const token = ++copyGeneration.current;
    const view = owner.current;
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
    if (
      !active.current ||
      view !== owner.current ||
      token !== copyGeneration.current
    )
      return;
    setStatus(copied ? "Exact planned bytes copied." : "");
    setCopyFailure(copied ? null : kind);
  };
  const loadSources = async () => {
    if (!entry) return;
    const view = owner.current;
    const token = ++sourceGeneration.current;
    const sourceIds = entry.sourceIds;
    setSourceError("");
    try {
      const { loadKnowledge } = await import("../../knowledge/load");
      const corpus = await loadKnowledge();
      if (
        active.current &&
        view === owner.current &&
        token === sourceGeneration.current
      )
        setSources(
          corpus.sources.filter((source) => sourceIds.includes(source.id)),
        );
    } catch {
      if (
        active.current &&
        view === owner.current &&
        token === sourceGeneration.current
      )
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
      <h1>Offline protocol explorer</h1>
      <p>
        Compile an authored pixel example without a device. This logical preview
        does not prove physical rendering or accepted device support.
      </p>
      <label>
        Implementation{" "}
        <select
          value={referenceId}
          onChange={(event) => selectReference(event.currentTarget.value)}
        >
          {!findOfflineEntry(referenceId) && (
            <option value={referenceId}>Unknown reference</option>
          )}
          {offlineCatalog.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {loading && <p role="status">Loading offline reference…</p>}
      {loadError && (
        <div role="alert">
          <p>Reference unavailable: {loadError}</p>
          <button onClick={() => window.location.reload()}>
            Retry reference loading
          </button>
        </div>
      )}
      {entry && (
        <>
          <p>
            {entry.label} · {entry.geometry.width}×{entry.geometry.height}{" "}
            logical pixels
          </p>
          <label>
            Example{" "}
            <select
              value={example}
              onChange={(event) => compile(entry, event.currentTarget.value)}
            >
              {entry.examples.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <div role="alert">
              <p>Compilation failed: {error}</p>
              <button onClick={() => compile(entry, example)}>
                Retry compilation
              </button>
            </div>
          )}
          {result && (
            <>
              <section aria-label="Logical pixels">
                <h2>Logical pixels</h2>
                <FramePreview
                  frame={result.preview}
                  scale={Math.min(24, Math.floor(352 / entry.geometry.width))}
                  label={`${example} logical pixels, ${entry.geometry.width} columns and ${entry.geometry.height} rows`}
                />
                <p>{entry.previewDescription}</p>
              </section>
              <section aria-label="Planned transfer bytes">
                <h2>Planned transfer bytes</h2>
                <p>{entry.deliveryDescription}</p>
                <p>
                  Planned ShowFrame · dry-run-only.{" "}
                  {result.plan.metadata.consequence}
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
                        {p.index} · {p.bytes.length} bytes
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
                      Could not copy bytes. Retry or select the displayed exact
                      hex.
                    </p>
                    <button onClick={() => void copy(copyFailure)}>
                      Retry copy
                    </button>
                  </div>
                )}
              </section>
              <details key={referenceId}>
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
                <p>{entry.pixelPolicy}</p>
                {entry.limitations.map((text) => (
                  <p key={text}>{text}</p>
                ))}
                <p>Source basis: {result.reference.sourceBasis.join(" · ")}</p>
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
        </>
      )}
    </main>
  );
}
