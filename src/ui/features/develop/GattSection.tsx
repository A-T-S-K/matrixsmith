import type { JSX } from "preact";
import type {
  AppSnapshot,
  PresentationStore,
} from "../../../presentation/store";
import { Copy } from "./EvidenceSections";
import { UnavailableAction } from "../../components/UnavailableAction";
export function GattSection({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  return (
    <section>
      <div class="section-heading">
        <h2>GATT explorer</h2>
        <p>
          Browser-authorized services and characteristic-scoped safe actions.
        </p>
      </div>
      <div class="gatt-tree">
        {snapshot.gatt.length ? (
          snapshot.gatt.map((service) => (
            <details key={service.uuid} open>
              <summary>
                <span class="service-icon">S</span>
                <strong>{service.uuid}</strong>
                <small>{service.primary ? "Primary service" : "Service"}</small>
                <Copy value={service.uuid} store={store} />
              </summary>
              <div class="characteristics">
                {service.characteristics.map((c) => (
                  <article key={c.uuid} class="characteristic">
                    <div class="characteristic-main">
                      <span class="char-icon">C</span>
                      <div>
                        <code>{c.uuid}</code>
                        <div class="property-list">
                          {c.properties.map((p) => (
                            <span key={p}>{p}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div class="char-actions">
                      <Copy value={c.uuid} store={store} />
                      {c.canRead && (
                        <UnavailableAction
                          class="secondary small"
                          available={snapshot.liveConnected}
                          reason="Live operations are blocked for offline reports."
                          onClick={() =>
                            void store.readCharacteristic({
                              serviceUuid: c.serviceUuid,
                              characteristicUuid: c.uuid,
                            })
                          }
                        >
                          Read
                        </UnavailableAction>
                      )}
                      {c.canSubscribe && (
                        <UnavailableAction
                          class="secondary small"
                          available={!c.subscribed && snapshot.liveConnected}
                          reason={
                            c.subscribed
                              ? "Notifications are already subscribed."
                              : "Live operations are blocked for offline reports."
                          }
                          onClick={() =>
                            void store.toggleSubscription({
                              serviceUuid: c.serviceUuid,
                              characteristicUuid: c.uuid,
                            })
                          }
                        >
                          {c.subscribed ? "Subscribed" : "Subscribe"}
                        </UnavailableAction>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </details>
          ))
        ) : (
          <p class="empty">
            No accessible GATT hierarchy. Browser permission limits may apply.
          </p>
        )}
      </div>
    </section>
  );
}
