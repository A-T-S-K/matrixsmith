# Vendor APK static analysis

No APK was installed or executed. Earlier work used archive hashes, ZIP inspection, string extraction, and static Flutter AOT analysis.

## `com.led.iledcolor` 1.0.59

- archive SHA-256: `680ed92d668159ef56a908df5c2726471f363cb7590bda59a97b3d340a7c0668`
- Flutter/Dart 3.11.5 snapshot hash: `78da37fed6bf1489361a312568249f3f`
- recovered BLE-related package paths include `BleManager.dart`, `BleSendManager.dart`, `UUIDConfig.dart`, and resource/graffiti/GIF send utilities
- recovered full A950–A953 UUID strings
- no literal FFF0/F1 packet provenance was recovered

Interpretation: this is useful vendor-family evidence. It contains a newer A950 path and BLE-related implementation, and the wider vendor ecosystem includes legacy and Jieli-related support. It is supporting but not decisive evidence for the observed single-characteristic FFF0/F1 iLedHat. It should not be described as simply rejected, nor used to claim packet provenance it does not establish.

## `com.led.miniled` 1.3.3

- archive SHA-256: `d97c7f6a87dbab03900125f8234e31b55215b63f1c4974ba4caccb2ce22ecd91`
- recovered `iledcolor` and `miniledshow` protocol namespaces
- recovered A950–A953 and AE00–AE02 UUID families
- no direct FFF0/F1 provenance recovered

This confirms that one vendor/product domain can contain multiple incompatible transports. It supports the driver/profile separation and argues against matching by brand alone.

## Historical `iLed Show`

The iOS release history mentioned 16-pixel-high font fixes, 32×32 resolution, and clearing by program ID; a review mentioned a hat. No legally accessible binary was obtained, so it remains historical product-family context rather than packet evidence.
