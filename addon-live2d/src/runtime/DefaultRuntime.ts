import { createRuntimeProvider, type RuntimeProviderOptions } from './RuntimeProvider.js';

// Static asset URLs let application bundlers copy/fingerprint the untouched Core executable and
// self-contained CPU module. They are produced from the pinned repository SDK during package build.
const create = createRuntimeProvider({
    coreUrl: new URL('./prebuilt/live2dcubismcore.min.js', import.meta.url),
    moduleUrl: new URL('./prebuilt/runtime-core.js', import.meta.url)
});

/** @internal Lazy package-local runtime; no CDN or application deployment setup is required. */
export function createDefaultLive2DRuntime(
    options?: Readonly<RuntimeProviderOptions>
): Promise<unknown> {
    return create(options);
}
