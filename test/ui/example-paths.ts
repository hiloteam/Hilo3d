import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ExampleBackend = 'webgl2' | 'webgpu';

export interface ExampleCase {
    readonly path: string;
    readonly backend: ExampleBackend;
}

export type ExampleCompletionContract =
    'compressed-textures' | 'gltf-viewer' | 'resource-diagnostics';

export const EXAMPLE_BACKENDS = ['webgl2', 'webgpu'] as const;
export const WEBGL2_ONLY_EXAMPLE_PATHS = ['webxr.html'] as const;
export const NON_RENDERING_EXAMPLE_PATHS = ['math.html'] as const;
export const EXAMPLE_QUERY_PARAMETERS: Readonly<
    Partial<Record<string, Readonly<Record<string, string>>>>
> = {
    'glTFViewer/index.html': { url: '/examples/models/Tmall/Tmall.gltf' }
};
export const EXAMPLE_COMPLETION_CONTRACTS: Readonly<
    Partial<Record<string, ExampleCompletionContract>>
> = {
    'compressed_texture.html': 'compressed-textures',
    'glTFViewer/index.html': 'gltf-viewer',
    'resourceManagerTest.html': 'resource-diagnostics'
};

const webgl2OnlyExamples = new Set<string>(WEBGL2_ONLY_EXAMPLE_PATHS);
const nonRenderingExamples = new Set<string>(NON_RENDERING_EXAMPLE_PATHS);
const examplesDirectory = fileURLToPath(new URL('../../examples/', import.meta.url));

function collectHtmlFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectHtmlFiles(path);
        return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
    });
}

export const examplePaths = Object.freeze(
    collectHtmlFiles(examplesDirectory)
        .map(path => relative(examplesDirectory, path).split(sep).join('/'))
        .sort()
);

export function backendsForExample(examplePath: string): readonly ExampleBackend[] {
    return webgl2OnlyExamples.has(examplePath) ? ['webgl2'] : EXAMPLE_BACKENDS;
}

export function exampleRequiresRendering(examplePath: string): boolean {
    return !nonRenderingExamples.has(examplePath);
}

export function exampleRequestUrl(examplePath: string, backend: ExampleBackend): string {
    const parameters = new URLSearchParams({
        backend,
        ...(EXAMPLE_QUERY_PARAMETERS[examplePath] ?? {})
    });
    return `/examples/${examplePath}?${parameters.toString()}`;
}

export function completionContractForExample(
    examplePath: string
): ExampleCompletionContract | null {
    return EXAMPLE_COMPLETION_CONTRACTS[examplePath] ?? null;
}

export const exampleCases: readonly ExampleCase[] = Object.freeze(
    examplePaths.flatMap(path => backendsForExample(path).map(backend => ({ path, backend })))
);
