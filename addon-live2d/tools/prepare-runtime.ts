import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLive2DRuntime, type BuildLive2DRuntimeResult } from './build-runtime.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const vendorRoot = resolve(projectRoot, 'vendor');
const sdkRoot = resolve(vendorRoot, 'cubism-5-r.5');
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

/** Build the package or gallery runtime from the same verified, repository-owned SDK inputs. */
export async function buildPinnedLive2DRuntime(
    directory: string
): Promise<BuildLive2DRuntimeResult> {
    await verifyVendorFiles();
    return buildLive2DRuntime({
        sdkDirectory: sdkRoot,
        outputDirectory: directory
    });
}
