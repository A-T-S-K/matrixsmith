import type { ApplicationCommand } from "./commands";

/** Edge port implemented by the composed presentation/application workspace. */
export interface ApplicationEffectPort {
  connect(
    mode?: "registered" | "inspection",
    optionalServices?: BluetoothServiceUUID[],
  ): Promise<void>;
  reconnectAuthorized(deviceId: string): Promise<void>;
  importBundle(content: string): void;
  importExternalCapture(content: string): void;
  resumeStoredInvestigation(): void;
  forgetLocalHistory(): void;
}

export async function runApplicationEffect(
  port: ApplicationEffectPort,
  command: ApplicationCommand,
): Promise<void> {
  switch (command.kind) {
    case "connect":
      await port.connect(
        command.mode,
        command.optionalServices ? [...command.optionalServices] : undefined,
      );
      return;
    case "reconnect":
      await port.reconnectAuthorized(command.deviceId);
      return;
    case "import-bundle":
      port.importBundle(command.content);
      return;
    case "import-capture":
      port.importExternalCapture(command.content);
      return;
    case "resume-investigation":
      port.resumeStoredInvestigation();
      return;
    case "forget-history":
      port.forgetLocalHistory();
  }
}
