import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { cookMeshletAsset, type CookedMeshletAsset, type MeshletCookInput } from './meshlet-cooker';
import {
    decodeMeshletGeometryPage,
    validateMeshletGeometryPage
} from '../../src/geometry/meshlet/MeshletAsset';
import MeshletGeometry from '../../src/geometry/meshlet/MeshletGeometry';

interface SourceAsset {
    readonly name: string;
    readonly material: string;
    readonly streamed: boolean;
    readonly triangles: number;
    readonly vertices: number;
}

interface PreparedAsset {
    readonly asset: SourceAsset;
    readonly primitive: Readonly<Record<string, unknown>>;
    readonly cooked: CookedMeshletAsset;
    readonly coarseTriangles: number;
    readonly bytes: number;
    readonly digest: string;
}

const sourceRoot = new URL('../../reports/strata-source/', import.meta.url);
const outputRoot = new URL('../../examples/models/Strata/', import.meta.url);
const lodRatios = [0.5, 0.2, 0.08];
const errorOverrides: Readonly<Record<string, number>> = {
    arch: 0.16,
    monolith: 0.12,
    boulder: 0.08
};

function record(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError(`${label} must be an object`);
    return value as Record<string, unknown>;
}

function list(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}

function name(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]*$/u.test(value))
        throw new TypeError(`${label} must be a safe asset identifier`);
    return value;
}

function count(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
        throw new RangeError(`${label} must be a positive integer`);
    return value;
}

function numbers(value: unknown, label: string): number[] {
    return list(value, label).map(component => {
        if (typeof component !== 'number' || !Number.isFinite(component))
            throw new TypeError(`${label} must contain finite numbers`);
        return component;
    });
}

function primitiveInput(primitive: Record<string, unknown>): MeshletCookInput {
    const allowed = new Set(['positions', 'normals', 'uv0', 'indices']);
    if (Object.keys(primitive).some(key => !allowed.has(key)))
        throw new TypeError('STRATA primitive contains unsupported attributes');
    const indices = numbers(primitive['indices'], 'indices');
    if (indices.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff))
        throw new RangeError('STRATA indices must be uint32');
    return {
        positions: new Float32Array(numbers(primitive['positions'], 'positions')),
        normals: new Float32Array(numbers(primitive['normals'], 'normals')),
        uv0: new Float32Array(numbers(primitive['uv0'], 'uv0')),
        indices: new Uint32Array(indices)
    };
}

async function formattedJSON(path: URL, value: unknown): Promise<string> {
    const filename = fileURLToPath(path);
    return format(JSON.stringify(value), {
        ...(await resolveConfig(filename)),
        filepath: filename
    });
}

function isFileError(error: unknown, ...codes: readonly string[]): boolean {
    return (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        codes.includes(error.code)
    );
}

async function verifyImmutableDirectory(
    directory: URL,
    files: ReadonlyMap<string, Uint8Array | string>
): Promise<void> {
    for (const [filename, expected] of files) {
        const actual = await readFile(new URL(filename, directory));
        const bytes =
            typeof expected === 'string' ? Buffer.from(expected, 'utf8') : Buffer.from(expected);
        if (!actual.equals(bytes))
            throw new Error(
                `Immutable STRATA version differs: ${new URL(filename, directory).href}`
            );
    }
}

async function publishImmutableDirectory(
    directory: URL,
    files: ReadonlyMap<string, Uint8Array | string>
): Promise<void> {
    try {
        await stat(directory);
        await verifyImmutableDirectory(directory, files);
        return;
    } catch (error: unknown) {
        if (!isFileError(error, 'ENOENT')) throw error;
    }
    const parent = new URL('../', directory);
    await mkdir(parent, { recursive: true });
    const staging = await mkdtemp(fileURLToPath(new URL('.staging-', parent)));
    try {
        for (const [filename, contents] of files)
            await writeFile(join(staging, filename), contents);
        try {
            await rename(staging, fileURLToPath(directory));
        } catch (error: unknown) {
            if (!isFileError(error, 'EEXIST', 'ENOTEMPTY')) throw error;
            await verifyImmutableDirectory(directory, files);
        }
    } finally {
        await rm(staging, { recursive: true, force: true });
    }
}

const rawScene = await readFile(new URL('scene-source.json', sourceRoot), 'utf8');
const scene = record(JSON.parse(rawScene) as unknown, 'STRATA scene');
if (scene['version'] !== 1) throw new RangeError('STRATA source schema must be version 1');
const materials = record(scene['materials'], 'materials');
const assetNames = new Set<string>();
const assets = list(scene['assets'], 'assets').map((raw): SourceAsset => {
    const value = record(raw, 'asset');
    const assetName = name(value['name'], 'asset name');
    const material = name(value['material'], 'asset material');
    if (assetNames.has(assetName) || materials[material] === undefined)
        throw new Error('Duplicate STRATA asset or missing material');
    if (typeof value['streamed'] !== 'boolean') throw new TypeError('streamed must be boolean');
    assetNames.add(assetName);
    return {
        name: assetName,
        material,
        streamed: value['streamed'],
        triangles: count(value['triangles'], 'triangles'),
        vertices: count(value['vertices'], 'vertices')
    };
});
const instanceCounts = new Map<string, number>();
for (const raw of list(scene['instances'], 'instances')) {
    const assetName = name(record(raw, 'instance')['asset'], 'instance asset');
    if (!assetNames.has(assetName)) throw new Error('STRATA instance references an unknown asset');
    instanceCounts.set(assetName, (instanceCounts.get(assetName) ?? 0) + 1);
}
const sourceTriangles = assets.reduce(
    (sum, asset) => sum + asset.triangles * (instanceCounts.get(asset.name) ?? 0),
    0
);
if (sourceTriangles !== scene['sourceTriangles'])
    throw new Error('STRATA instanced source triangle total differs from metadata');
const fingerprint = createHash('sha256')
    .update('STRATA/schema1/conservative-cones-v2/meshoptimizer1.3.0/lod0.5,0.2,0.08')
    .update(rawScene);
const textureNames = new Set<string>();
for (const raw of Object.values(materials)) {
    const texture = record(raw, 'material')['texture'];
    if (texture === null) continue;
    if (typeof texture !== 'string' || !/^[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp)$/u.test(texture))
        throw new TypeError('STRATA texture must name a local image');
    textureNames.add(texture);
}
for (const texture of [...textureNames].sort())
    fingerprint.update(texture).update(await readFile(new URL(texture, outputRoot)));
const prepared: PreparedAsset[] = [];
for (const asset of assets) {
    const raw = await readFile(new URL(`${asset.name}.json`, sourceRoot), 'utf8');
    const primitive = record(JSON.parse(raw) as unknown, asset.name);
    const input = primitiveInput(primitive);
    if (
        input.positions.length / 3 !== asset.vertices ||
        input.indices.length / 3 !== asset.triangles
    )
        throw new Error(`STRATA ${asset.name} source counts changed without metadata`);
    const maxError = errorOverrides[asset.name] ?? 0.12;
    fingerprint.update(asset.name).update(raw).update(String(maxError));
    // Static primitives use the same strict input and fine-page geometry checks, but remain
    // ordinary vertex/index assets in the shipped scene, without runtime page manifests.
    const cooked = await cookMeshletAsset(input, {
        lodRatios: asset.streamed ? lodRatios : [],
        maxError
    });
    const assetFingerprint = createHash('sha256').update(
        asset.streamed ? JSON.stringify(cooked.manifest) : raw
    );
    const validatedGeometry = new MeshletGeometry(cooked.manifest);
    let bytes = 0;
    for (const descriptor of cooked.manifest.pages) {
        const data = cooked.pages.get(descriptor.id);
        if (!data) throw new Error('Cooker omitted a STRATA page');
        const decoded = decodeMeshletGeometryPage(data, descriptor);
        validateMeshletGeometryPage(decoded, descriptor);
        validatedGeometry.setPageData(descriptor.id, decoded);
        bytes += data.byteLength;
        if (asset.streamed) fingerprint.update(data);
        if (asset.streamed) assetFingerprint.update(data);
    }
    let coarseTriangles = 0;
    for (const group of cooked.manifest.groups) {
        const coarse = group.lods.at(-1);
        const descriptor = cooked.manifest.pages.find(page => page.id === coarse?.pageId);
        if (!descriptor || !(group.bounds[3] > 0))
            throw new Error('STRATA group has missing coarse data or degenerate bounds');
        coarseTriangles += descriptor.indexCount / 3;
    }
    prepared.push({
        asset,
        primitive,
        cooked,
        coarseTriangles,
        bytes,
        digest: assetFingerprint.digest('hex')
    });
    console.log(
        JSON.stringify({
            asset: asset.name,
            streamed: asset.streamed,
            groups: cooked.manifest.groups.length,
            pages: cooked.pages.size,
            sourceTriangles: asset.triangles,
            coarseTriangles,
            bytes
        })
    );
}

await mkdir(outputRoot, { recursive: true });
for (const entry of prepared) {
    if (entry.asset.streamed) {
        const directory = new URL(`pages/${entry.asset.name}/${entry.digest}/`, outputRoot);
        const files = new Map<string, Uint8Array | string>();
        for (const [id, data] of entry.cooked.pages) files.set(`page-${String(id)}.bin`, data);
        files.set(
            'manifest.json',
            await formattedJSON(new URL('manifest.json', directory), entry.cooked.manifest)
        );
        await publishImmutableDirectory(directory, files);
    } else {
        const directory = new URL(`geometry/${entry.asset.name}/${entry.digest}/`, outputRoot);
        await publishImmutableDirectory(
            directory,
            new Map([
                [
                    'geometry.json',
                    await formattedJSON(new URL('geometry.json', directory), entry.primitive)
                ]
            ])
        );
    }
}
const contentVersion = `sha256:${fingerprint.digest('hex')}`;
const coarseTriangles = prepared.reduce(
    (sum, entry) => sum + entry.coarseTriangles * (instanceCounts.get(entry.asset.name) ?? 0),
    0
);
const sceneOutput = await formattedJSON(new URL('scene.json', outputRoot), {
    ...scene,
    contentVersion,
    coarseTriangles,
    assets: prepared.map(entry => ({
        ...entry.asset,
        ...(entry.asset.streamed
            ? { manifestURL: `./pages/${entry.asset.name}/${entry.digest}/manifest.json` }
            : { geometryURL: `./geometry/${entry.asset.name}/${entry.digest}/geometry.json` })
    }))
});
const sceneStaging = await mkdtemp(fileURLToPath(new URL('.scene-staging-', outputRoot)));
try {
    const stagedScene = join(sceneStaging, 'scene.json');
    await writeFile(stagedScene, sceneOutput);
    await rename(stagedScene, fileURLToPath(new URL('scene.json', outputRoot)));
} finally {
    await rm(sceneStaging, { recursive: true, force: true });
}
console.log(
    JSON.stringify({
        contentVersion,
        sourceTriangles,
        coarseTriangles,
        instances: list(scene['instances'], 'instances').length,
        streamedWireBytes: prepared
            .filter(entry => entry.asset.streamed)
            .reduce((sum, entry) => sum + entry.bytes, 0)
    })
);
