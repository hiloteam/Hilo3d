import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Copy the pinned C-ABI binary without adapting or publishing its JavaScript wrapper. */
export async function prepareAssetRuntime(destination: URL): Promise<void> {
    const binary = await readFile(
        fileURLToPath(
            import.meta.resolve('@h00w/basis-universal-transcoder/basis_capi_transcoder.wasm')
        )
    );
    const hash = createHash('sha256').update(binary).digest('hex');
    if (hash !== 'b407e8e2c510b5154e3fa9de286a94334c46069ebc8dfc3a3e9119a7a8dc5bf7')
        throw new Error('Basis WASM ABI input checksum changed.');
    await mkdir(dirname(fileURLToPath(destination)), { recursive: true });
    const existing = await readFile(destination).catch((error: unknown) => {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
        )
            return null;
        throw error;
    });
    if (existing?.equals(binary)) return;
    const temporary = `${fileURLToPath(destination)}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, binary);
        await rename(temporary, destination);
    } finally {
        await rm(temporary, { force: true });
    }
}
