# WebBlox WASM crash diagnostic build

## Changes in this build

- The default engine settings profile is now Roblox's live `WebClientApp` flags instead of the bundled pinned snapshot. This removes the pinned experimental flag snapshot from the default startup path while keeping it available for comparison.
- `?flagset=pinned` explicitly restores the bundled pinned profile. `?flagset=live` explicitly selects live settings.
- Worker `error` and `messageerror` events are now captured with worker URL, source location, and any available exception name/message/stack details.
- Main-thread uncaught errors and rejected promises now include runtime capability information (cross-origin isolation, SharedArrayBuffer availability, and WASM memory size when exposed).
- Build identifiers have been changed so deployment logs can prove whether the new files are actually live.

## Test after deployment

1. Deploy the complete project, not only `index.html`. The new index build identifier is `wasm-diag-20261105a`; the renderer identifier is `ttl-wasm-diag`.
2. Clear the site's cached assets/service worker (or use a private window) and open the same game URL.
3. Confirm the on-screen `BUILD` line contains both identifiers above and `upstream=wasm-diag-20261105a`.
4. If the crash remains, copy the complete `Failed requests (newest last)` panel. The worker diagnostic line should now identify the failing worker and provide a more useful error than `[object WebAssembly.Exception]`.
5. For a controlled comparison, try the same game once with `?flagset=pinned`. If live flags work but pinned flags crash, the pinned snapshot is implicated. If both fail in the same way, the next investigation should focus on the engine binary/version or storage/WASM initialization rather than the graphics backend.

The `RbxStorage::init using wasm interface` line is an initialization log, not by itself proof that RbxStorage caused the crash. The new diagnostics are intended to capture the actual failing worker/error before making deeper engine changes.
