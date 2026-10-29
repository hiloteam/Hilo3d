import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cookMeshletAsset, type MeshletCookInput } from './meshlet-cooker';

function numbers(input: Record<string, unknown>, name: string): number[] {
    const values: unknown = input[name];
    if (
        !Array.isArray(values) ||
        !values.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
    ) {
        throw new TypeError(`${name} must be a finite numeric array`);
    }
    return values as number[];
}

async function run(): Promise<void> {
    const [inputPath, outputPath, ...extra] = process.argv.slice(2);
    if (!inputPath || !outputPath || extra.length !== 0) {
        throw new Error('Usage: npm run geometry:cook -- input.json output-directory');
    }
    const parsed: unknown = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new TypeError('input must be a primitive object');
    const object = parsed as Record<string, unknown>;
    const supportedFields = new Set(['positions', 'normals', 'uv0', 'indices']);
    const unsupportedFields = Object.keys(object).filter(field => !supportedFields.has(field));
    if (unsupportedFields.length !== 0) {
        throw new TypeError(
            `Unsupported meshlet primitive fields: ${unsupportedFields.join(', ')}`
        );
    }
    const indexValues = numbers(object, 'indices');
    if (indexValues.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
        throw new RangeError('indices must be unsigned 32-bit integers');
    }
    const input: MeshletCookInput = {
        positions: new Float32Array(numbers(object, 'positions')),
        normals: new Float32Array(numbers(object, 'normals')),
        uv0: new Float32Array(numbers(object, 'uv0')),
        indices: new Uint32Array(indexValues)
    };
    const asset = await cookMeshletAsset(input);
    const destination = resolve(outputPath);
    // Refuse to replace an existing asset directory: callers choose a fresh version directory.
    await mkdir(destination);
    for (const [id, bytes] of asset.pages)
        await writeFile(resolve(destination, `page-${String(id)}.bin`), bytes);
    await writeFile(
        resolve(destination, 'manifest.json'),
        `${JSON.stringify(asset.manifest, null, 2)}\n`
    );
    console.log(
        `Cooked ${String(asset.manifest.groups.length)} groups and ${String(asset.pages.size)} pages into ${destination}`
    );
}

await run();
