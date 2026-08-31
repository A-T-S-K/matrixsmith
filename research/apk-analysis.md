# Vendor APK static analysis

No APK was installed or executed. Analysis was limited to public archive download, hash verification, ZIP inspection, string extraction, and static Flutter AOT analysis.

## `com.led.iledcolor` 1.0.59

- Public archive: `iledcolor_1.0.59_APKPure.xapk`
- Published and independently calculated SHA-256: `680ed92d668159ef56a908df5c2726471f363cb7590bda59a97b3d340a7c0668`
- Base APK: `com.led.iledcolor.apk`
- ARM64 application logic: `lib/arm64-v8a/libapp.so`
- Flutter/Dart runtime string: Dart `3.11.5`
- Snapshot hash: `78da37fed6bf1489361a312568249f3f`

The base package is Flutter. Its Java/Dex layer is primarily the Flutter host and plugins; application protocol logic is AOT-compiled into `libapp.so`. Static AOT inspection recovered package paths including:

```text
package:led_base_project/code/ble/BleManager.dart
package:led_base_project/code/ble/BleSendManager.dart
package:led_base_project/code/ble/protocol/new/UUIDConfig.dart
package:led_base_project/code/ble/protocol/new/ResourceSendUtil.dart
package:led_base_project/code/ble/protocol/new/GraffitiSendUtil.dart
package:led_base_project/code/ble/protocol/new/GifFileSendUtil.dart
```

It also recovered these full UUID strings:

```text
0000A950-0000-1000-8000-00805F9B34FB
0000A951-0000-1000-8000-00805F9B34FB
0000A952-0000-1000-8000-00805F9B34FB
0000A953-0000-1000-8000-00805F9B34FB
```

Searches for `FFF0`, `FFF1`, `0000fff0`, and `0000fff1` returned no application string. Absence of a literal is not mathematical proof that no dynamically constructed UUID exists, but the presence of a complete alternative UUID set and a clearly named `UUIDConfig.dart` makes this APK insufficient evidence for the supplied hat.

Conclusion: **VERIFIED vendor-family app; VERIFIED A950–A953 implementation evidence; no evidence of FFF0/FFF1 compatibility**.

## `com.led.miniled` 1.3.3

- Public archive: `miniled_1.3.3_APKPure.xapk`
- Published and independently calculated SHA-256: `d97c7f6a87dbab03900125f8234e31b55215b63f1c4974ba4caccb2ce22ecd91`
- Flutter ARMv7 application logic: `lib/armeabi-v7a/libapp.so`

Static strings show two explicit application protocol namespaces:

```text
package:miniled/ble/protocol/iledcolor/...
package:miniled/ble/protocol/miniledshow/...
```

and two full UUID families:

```text
0000A950 / A951 / A952 / A953 ...
0000AE00 / AE01 / AE02 ...
```

Again, searches found no FFF0/FFF1 literal. This package therefore confirms that even applications from the same vendor can carry multiple incompatible BLE transports; it does not identify this device's transport.

Conclusion: **VERIFIED vendor-family app; no evidence of FFF0/FFF1 compatibility**.

## Important limitation

The older iOS-only `iLed Show` app is historically more suggestive: its 2020 release notes mention a bug in 16-pixel-high fonts, clearing a display by program ID, and added 32×32 resolution support. Its App Store reviews also explicitly mention a hat. However, no legally accessible IPA or Android equivalent was found during this pass, so its BLE code could not be statically traced.

Status: **STRONGLY INFERRED historical product-family relevance; UNKNOWN protocol**.
