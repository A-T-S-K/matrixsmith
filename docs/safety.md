# BLE safety model

## Allowed now

- scan through the browser chooser filtered by service FFF0
- connect/disconnect without bonding
- enumerate the confirmed primary service and characteristic
- inspect characteristic properties
- call `startNotifications()` / `stopNotifications()`
- log passive notifications
- perform the already-observed FFF1 read, which returns zero bytes on the test unit
- create and preview framebuffers entirely in browser memory

## Blocked now

- every FFF1 characteristic write
- guessed status/version/capability queries
- raw hex entry
- fuzzing and probe sequences
- display, brightness, rotation, password, storage, reset, delete, OTA, DFU, and firmware commands

The application records a blocked TX attempt as `TX [BLOCKED] ...`, but its production UI provides no way to attempt one.

## Command classification once recovered

| Class | Examples | Policy |
|---|---|---|
| read-only query | version, status, capabilities | first candidate after packet provenance and golden tests |
| transient control | preview framebuffer, volatile brightness | requires evidence it does not persist or write flash |
| persistent write | saved program, boot image, device name, password | deferred until transient control is visually confirmed |
| destructive | delete all, factory reset, flash erase | prohibited without explicit user authorization and recovery plan |
| firmware/DFU | bootloader entry, OTA start/data/finalize | prohibited during protocol discovery |

## Recovery information currently known

No documented recovery mode, factory reset sequence, firmware image, or wired programming interface has been verified for this unit. That absence increases the cost of a bad write and is a primary reason for the fail-closed transport.
