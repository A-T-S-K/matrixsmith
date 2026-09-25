/** User/application intents; commands carry semantics, never protocol bytes. */
export type ApplicationCommand =
  | {
      readonly kind: "connect";
      readonly mode?: "registered" | "inspection";
      readonly optionalServices?: readonly BluetoothServiceUUID[];
    }
  | { readonly kind: "reconnect"; readonly deviceId: string }
  | { readonly kind: "import-bundle"; readonly content: string }
  | { readonly kind: "import-capture"; readonly content: string }
  | { readonly kind: "resume-investigation" }
  | { readonly kind: "forget-history" };
