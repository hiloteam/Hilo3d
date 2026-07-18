export type ExampleBackend = 'webgl2' | 'webgpu';

/** Resolve an explicitly selected example backend without silent fallback. */
export function resolveExampleBackend(url: string | URL = location.href): ExampleBackend {
    const value = new URL(url, location.href).searchParams.get('backend');
    if (value === null || value === '' || value === 'webgl2') return 'webgl2';
    if (value === 'webgpu') return 'webgpu';
    throw new TypeError(`Unsupported example backend "${value}"; expected "webgl2" or "webgpu".`);
}
