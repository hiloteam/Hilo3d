import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLive2DRuntime } from '../addon-live2d/tools/build-runtime.js';

/** Public gallery location; development and production serve exactly this directory. */
export const LIVE2D_EXAMPLE_RUNTIME_DIRECTORY = 'examples/assets/live2d/runtime';

/** Generated runtime allowlist, including its notices and provenance manifest. */
export interface Live2DExampleRuntime {
    readonly directory: string;
    readonly files: ReadonlyMap<string, string>;
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const vendorRoot = resolve(projectRoot, 'third-party/live2d');
const sdkRoot = resolve(vendorRoot, 'cubism-5-r.5');
let pending: Promise<Live2DExampleRuntime> | null = null;
let building: Promise<Live2DExampleRuntime> | null = null;
let sourceRevision = 0;

function relativeFile(root: string, path: string): string {
    const local = relative(root, path);
    if (isAbsolute(local) || local === '' || local === '..' || local.startsWith(`..${sep}`)) {
        throw new Error('Live2D runtime files must remain inside their declared directory.');
    }
    return local.split(sep).join('/');
}

async function verifyVendorFiles(): Promise<void> {
    const manifest: unknown = JSON.parse(
        await readFile(resolve(vendorRoot, 'provenance.json'), 'utf8')
    );
    if (
        typeof manifest !== 'object' ||
        manifest === null ||
        !('files' in manifest) ||
        !Array.isArray(manifest.files)
    ) {
        throw new Error('Live2D vendor provenance must declare its file hashes.');
    }
    const files: readonly unknown[] = manifest.files;
    const paths = new Set<string>();
    await Promise.all(
        files.map(async value => {
            if (
                typeof value !== 'object' ||
                value === null ||
                !('path' in value) ||
                typeof value.path !== 'string' ||
                !('sha256' in value) ||
                typeof value.sha256 !== 'string' ||
                !/^[a-f0-9]{64}$/u.test(value.sha256) ||
                !('bytes' in value) ||
                !Number.isSafeInteger(value.bytes) ||
                typeof value.bytes !== 'number' ||
                value.bytes < 0
            ) {
                throw new Error('Live2D vendor file metadata is invalid.');
            }
            const path = resolve(vendorRoot, value.path);
            if (relativeFile(vendorRoot, path) !== value.path || paths.has(value.path)) {
                throw new Error('Live2D vendor file paths must be unique and normalized.');
            }
            paths.add(value.path);
            relativeFile(vendorRoot, await realpath(path));
            const bytes = await readFile(path);
            if (
                bytes.byteLength !== value.bytes ||
                createHash('sha256').update(bytes).digest('hex') !== value.sha256
            ) {
                throw new Error(
                    `Vendored Live2D file differs from its pinned original: ${value.path}`
                );
            }
        })
    );
}

async function generate(): Promise<Live2DExampleRuntime> {
    await verifyVendorFiles();
    const directory = resolve(projectRoot, '.cache/live2d-example-runtime');
    const result = await buildLive2DRuntime({
        coreFile: resolve(sdkRoot, 'Core/live2dcubismcore.min.js'),
        frameworkDirectory: resolve(sdkRoot, 'Framework'),
        outputDirectory: directory,
        additionalLicenseFiles: [resolve(sdkRoot, 'Core/RedistributableFiles.txt')]
    });
    const files = new Map<string, string>();
    for (const file of result.files) files.set(relativeFile(directory, file), file);
    return { directory, files };
}

/** Invalidate a development runtime after its source inputs change. Builds remain serialized. */
export function invalidateLive2DExampleRuntime(): void {
    sourceRevision++;
    pending = null;
}

/** Verify original SDK bytes and share one offline runtime until a watched source changes. */
export function prepareLive2DExampleRuntime(): Promise<Live2DExampleRuntime> {
    if (pending === null) {
        const revision = sourceRevision;
        const previous = building;
        const attempt = (async (): Promise<Live2DExampleRuntime> => {
            if (previous !== null) {
                try {
                    await previous;
                } catch {
                    /* A corrected source can retry a failed build. */
                }
            }
            return generate();
        })();
        building = attempt;
        const current: Promise<Live2DExampleRuntime> = attempt.then(runtime =>
            revision === sourceRevision ? runtime : prepareLive2DExampleRuntime()
        );
        pending = current;
        void current.catch(() => {
            if (pending === current) pending = null;
        });
    }
    return pending;
}

const invoked = process.argv[1];
if (invoked && pathToFileURL(resolve(invoked)).href === import.meta.url) {
    const runtime = await prepareLive2DExampleRuntime();
    process.stdout.write(`Prepared offline Live2D runtime: ${runtime.directory}\n`);
}
