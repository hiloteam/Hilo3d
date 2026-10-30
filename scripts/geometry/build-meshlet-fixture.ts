import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { cookMeshletAsset } from './meshlet-cooker';
import { createMeshletFixtureSource } from '../../test/fixtures/meshlets/source';

const destination = new URL('../../test/fixtures/meshlets/', import.meta.url);
const asset = await cookMeshletAsset(createMeshletFixtureSource(), { maxError: 0.15 });
for (const [id, bytes] of asset.pages) {
    await writeFile(new URL(`page-${String(id)}.bin`, destination), bytes);
}
const manifestURL = new URL('manifest.json', destination);
const manifestPath = fileURLToPath(manifestURL);
await writeFile(
    manifestURL,
    await format(JSON.stringify(asset.manifest), {
        ...(await resolveConfig(manifestPath)),
        filepath: manifestPath
    })
);
console.log(
    `Built reviewed fixture: ${String(asset.manifest.groups.length)} groups, ${String(asset.pages.size)} pages`
);
