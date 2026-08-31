# iLedHat controller

A local-only, open-source Web Bluetooth controller project for the 32×16 RGB matrix sold as `iLedHat` / `ILEDHAT`.

The current milestone is intentionally limited to safe diagnostics:

- select a device advertising service `FFF0`
- connect without pairing
- discover `FFF0` / `FFF1`
- report characteristic properties
- enable and log notifications
- perform the already-observed safe zero-length characteristic read
- render a 32×16 orientation pattern locally without transmitting it

There is **no command encoder, raw-hex input, or BLE write path**. The exact FFF1 protocol is not yet established. See [research/protocol-findings.md](research/protocol-findings.md).

## Development

```sh
npm install
npm test
npm run build
npm run dev
```

Web Bluetooth requires a secure context. Use HTTPS on the Galaxy S23; `localhost` is suitable for desktop development. The production build is static and can be hosted on GitHub Pages or Cloudflare Pages.

## Privacy

The application has no backend, analytics, telemetry, external fonts, or runtime third-party scripts. Browser CSP restricts network connections to the hosting origin. Display content stays in the browser unless and until a reviewed, verified BLE codec is added.
