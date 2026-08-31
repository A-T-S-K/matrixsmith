# Architecture

```text
Samsung Galaxy S23
  -> Chrome for Android (secure HTTPS context)
    -> static TypeScript PWA
      -> safe BLE transport
        -> Web Bluetooth
          -> service FFF0
            -> characteristic FFF1
              -> iLedHat peripheral
```

## Layer boundaries

- `src/ble` owns browser feature detection, device selection, GATT lifecycle, property reporting, reads, notification subscription, disconnect handling, and timestamped I/O logs.
- `src/protocol` will eventually own framing, commands, parsing, checksums, fragmentation, and the device codec. Today it is a fail-closed placeholder with no packet implementation.
- `src/render` owns a device-independent RGB888 framebuffer. It assumes logical 32×16 coordinates but no hardware scan order, channel order, or orientation.
- `src/storage` owns local browser presets. It does not transmit or synchronize them.
- `src/main.ts` renders the diagnostics UI and wires user gestures to the safe transport.
- `public/sw.js` caches same-origin static assets for offline use after first load.

The renderer has no Web Bluetooth dependency. The protocol layer has no DOM dependency. The BLE layer does not interpret display content.

## Security and privacy

- no backend, account, analytics, ads, or telemetry
- no runtime CDN or third-party JavaScript
- same-origin-only `connect-src` CSP
- Web Bluetooth chooser requires a user gesture and filters on confirmed service FFF0
- no unrestricted send-hex control
- no BLE write API in the safe transport
- no assumed pixel codec

`writeWithoutResponseSupported: yes` in diagnostics reports the characteristic property only. It is not permission for the app to write.
