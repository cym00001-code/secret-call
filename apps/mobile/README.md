# Secret Room Mobile

Android is the first supported release target.

## Build Model

- The app bundles the static web output from `apps/web/out`.
- The bundled UI connects to `https://8.138.150.200` for HTTP APIs and `wss://8.138.150.200/ws` for room WebSocket traffic.
- Android must enable `FLAG_SECURE` on the main activity before rendering sensitive content.
- iOS can only detect screenshots/screen capture and warn users; it cannot block system screenshots.
- Android/iOS native shells inject `window.__SECRET_ROOM_NATIVE_PLATFORM` so the web UI can show whether the peer is using the web page or an app.
- iOS screenshot and screen capture changes are bridged into the web UI through `security:capture_event`; the room then broadcasts a `security:event` system reminder.

## Release Notes

Run from the repository root after dependencies are installed:

```bash
npx pnpm@9.15.4 --filter @secret-room/mobile build:web
npx pnpm@9.15.4 --filter @secret-room/mobile sync
```

After Capacitor generates the platform projects, copy the native files in `native/android` and `native/ios` into their generated platform locations if they are not already present.
