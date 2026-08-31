export interface DiagnosticState {
  webBluetoothSupported: boolean;
  deviceSelected: boolean;
  deviceName: string | null;
  gattConnected: boolean;
  serviceFound: boolean;
  characteristicFound: boolean;
  readSupported: boolean;
  notifySupported: boolean;
  writeWithoutResponseSupported: boolean;
  notificationsEnabled: boolean;
}

export const initialDiagnosticState = (): DiagnosticState => ({
  webBluetoothSupported: "bluetooth" in navigator,
  deviceSelected: false,
  deviceName: null,
  gattConnected: false,
  serviceFound: false,
  characteristicFound: false,
  readSupported: false,
  notifySupported: false,
  writeWithoutResponseSupported: false,
  notificationsEnabled: false,
});
