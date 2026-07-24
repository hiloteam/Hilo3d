export type ExampleBackend = 'webgl2' | 'webgpu';

/** Resolve the selected example backend, defaulting to WebGPU without silent fallback. */
export function resolveExampleBackend(url: string | URL = location.href): ExampleBackend {
    const value = new URL(url, location.href).searchParams.get('backend');
    if (value === null || value === '' || value === 'webgpu') return 'webgpu';
    if (value === 'webgl2') return 'webgl2';
    throw new TypeError(`Unsupported example backend "${value}"; expected "webgl2" or "webgpu".`);
}
