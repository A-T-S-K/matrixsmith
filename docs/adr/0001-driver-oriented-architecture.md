# ADR 0001: Driver-oriented architecture and TransmissionPlan boundary

- Status: accepted
- Date: 2026-08-31

## Context

The initial spike directly connected `src/main.ts` to `SafeBleTransport`. That transport embedded FFF0/FFF1, the UI named one product, the framebuffer defaulted globally to 32×16, and the protocol layer intentionally failed closed. This was a sound safe diagnostic spike but could not support a second family without duplicating UI, logging, safety, and storage.

## Decision

Use simple TypeScript interfaces and static registries. Do not introduce dynamic plugin loading or a dependency injection framework.

1. UI expresses high-level `MatrixOperation` values through an application controller.
2. A statically registered family driver scores a portable fingerprint and resolves a separate physical device profile.
3. The driver compiles the operation into one immutable, inspectable `TransmissionPlan`.
4. A central `SafetyPolicy` either blocks the plan with reasons or returns an `AuthorizedTransmission`.
5. `TransmissionExecutor` sends the already-inspected packets through a generic endpoint-based transport.

## Rationale

Driver and profile are different because a protocol family can span dimensions/revisions, while visually related products can use incompatible protocols. Transport and driver are different because Web Bluetooth permission/session mechanics do not define packet semantics and future WebSerial/WebUSB/network transports should not duplicate codecs. `TransmissionPlan` is the TX boundary because policy, UI, diagnostics, tests, and execution need one exact artifact; re-encoding after approval would break that guarantee.

## Consequences

- Adding a family requires matcher/driver/profile/fixtures rather than rewriting the shell.
- Driver matching returns score, confidence, reasons, and contradictions; ambiguity blocks TX.
- Pure codecs and Fake/Replay transports are testable without hardware.
- Browser-observable evidence remains distinct from manual profile evidence.
- Live operations can remain narrowly gated while the same codecs provide rich offline dry runs.
