import { afterEach, describe, expect, it, vi } from 'vitest';
import { importAsset } from '../../../editor/assets';
import { createClip } from '../../../editor/animation';
import { createPrefab, instantiatePrefab } from '../../../editor/prefabs';
import { createProject, validateProject, type ProjectDocument } from '../../../editor/project';
import {
    exportProjectArchive,
    importProjectArchive,
    type ProjectWorkspaceManifest
} from '../../../editor/project-archive';
import { createDefaultScene } from '../../../editor/scene';
import { createScript } from '../../../editor/script-types';

interface FixtureEntry {
    name: string;
    data: Uint8Array<ArrayBuffer>;
    deflate?: boolean;
    descriptor?: boolean | 'unsigned';
    declaredSize?: number;
    attributes?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Independent bit-at-a-time CRC for adversarial ZIP fixtures, using the standard polynomial.
function checksum(data: Uint8Array): number {
    let result = 0xffffffff;
    for (const byte of data) {
        result ^= byte;
        for (let bit = 0; bit < 8; bit++)
            result = result & 1 ? (result >>> 1) ^ 0xedb88320 : result >>> 1;
    }
    return (result ^ 0xffffffff) >>> 0;
}

async function fixtureZip(entries: FixtureEntry[], prefix = new Uint8Array()): Promise<Blob> {
    const parts: BlobPart[] = [prefix];
    const directory: Uint8Array<ArrayBuffer>[] = [];
    let offset = prefix.length;
    for (const entry of entries) {
        const name = encoder.encode(entry.name);
        const data = entry.deflate
            ? new Uint8Array(
                  await new Response(
                      new Blob([entry.data])
                          .stream()
                          .pipeThrough(new CompressionStream('deflate-raw'))
                  ).arrayBuffer()
              )
            : entry.data;
        const local = new Uint8Array(30 + name.length);
        const view = new DataView(local.buffer);
        const flags = 0x800 | (entry.descriptor ? 8 : 0);
        const crc = checksum(entry.data);
        const size = entry.declaredSize ?? entry.data.length;
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, flags, true);
        view.setUint16(8, entry.deflate ? 8 : 0, true);
        view.setUint16(26, name.length, true);
        if (!entry.descriptor) {
            view.setUint32(14, crc, true);
            view.setUint32(18, data.length, true);
            view.setUint32(22, size, true);
        }
        local.set(name, 30);
        const central = new Uint8Array(46 + name.length);
        const centralView = new DataView(central.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, flags, true);
        centralView.setUint16(10, entry.deflate ? 8 : 0, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, data.length, true);
        centralView.setUint32(24, size, true);
        centralView.setUint16(28, name.length, true);
        centralView.setUint32(38, entry.attributes ?? 0, true);
        centralView.setUint32(42, offset, true);
        central.set(name, 46);
        parts.push(local, data);
        directory.push(central);
        offset += local.length + data.length;
        if (entry.descriptor) {
            const signed = entry.descriptor !== 'unsigned';
            const descriptor = new Uint8Array(signed ? 16 : 12);
            const descriptorView = new DataView(descriptor.buffer);
            const start = signed ? 4 : 0;
            if (signed) descriptorView.setUint32(0, 0x08074b50, true);
            descriptorView.setUint32(start, crc, true);
            descriptorView.setUint32(start + 4, data.length, true);
            descriptorView.setUint32(start + 8, size, true);
            parts.push(descriptor);
            offset += descriptor.length;
        }
    }
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(
        12,
        directory.reduce((sum, entry) => sum + entry.length, 0),
        true
    );
    endView.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}

async function filesOf(archive: Blob): Promise<FixtureEntry[]> {
    const bytes = new Uint8Array(await archive.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const entries: FixtureEntry[] = [];
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
        expect(view.getUint16(offset + 8, true)).toBe(0);
        const nameSize = view.getUint16(offset + 26, true);
        const extraSize = view.getUint16(offset + 28, true);
        const size = view.getUint32(offset + 18, true);
        const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameSize));
        const start = offset + 30 + nameSize + extraSize;
        entries.push({ name, data: bytes.slice(start, start + size) });
        offset = start + size;
    }
    return entries;
}

function file(entries: FixtureEntry[], name: string): FixtureEntry {
    const result = entries.find(entry => entry.name === name);
    if (!result) throw new Error(`Missing fixture file ${name}`);
    return result;
}

function manifest(entries: FixtureEntry[]): ProjectWorkspaceManifest {
    return JSON.parse(
        decoder.decode(file(entries, 'project.hilo.json').data)
    ) as ProjectWorkspaceManifest;
}

function updateManifest(entries: FixtureEntry[], value: ProjectWorkspaceManifest): void {
    file(entries, 'project.hilo.json').data = encoder.encode(JSON.stringify(value));
}

async function richProject(): Promise<ProjectDocument> {
    const project = createProject(createDefaultScene(), '陶土工作区');
    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = 2;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas image encoding unavailable');
    context.fillStyle = '#d07c5b';
    context.fillRect(0, 0, 3, 2);
    const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => {
            if (value) resolve(value);
            else reject(new Error('PNG encoding failed'));
        }, 'image/png');
    });
    const asset = await importAsset(new File([png], 'Clay tile.png', { type: 'image/png' }));
    asset.source.license = 'CC0-1.0';
    asset.source.attribution = 'Synthetic clay swatch for the editor archive test.';
    asset.source.originURL = 'https://example.com/materials/clay';
    project.assets[asset.id] = asset;
    const scene = project.scenes[project.activeSceneId];
    if (!scene) throw new Error('Missing scene');
    const material = scene.materials['terracotta'];
    if (!material) throw new Error('Missing material');
    material.baseColorTexture = asset.id;
    const script = createScript('rotate-script', '绕轴旋转');
    script.source =
        '\uFEFFglobalThis.__hiloArchiveExecuted = true;\n({ update(ctx, dt) { ctx.rotate(0, dt, 0); } })\n';
    project.scripts[script.id] = script;
    const sphere = scene.nodes['hero-sphere'];
    if (!sphere) throw new Error('Missing sphere');
    sphere.scripts = [script.id];
    const prefab = createPrefab(scene, 'sculpture', 'study-prefab', 'Sculpture');
    project.prefabs[prefab.id] = prefab;
    const instance = instantiatePrefab(scene, prefab, project.activeSceneId, 'study-instance');
    project.scenes[project.activeSceneId] = instance.scene;
    project.instances[instance.instance.id] = instance.instance;
    const clip = createClip('rise-clip', project.activeSceneId);
    clip.tracks = [
        {
            id: 'rise-y',
            nodeId: instance.instance.rootId,
            property: 'position.y',
            keys: [
                { time: 0, value: 0, interpolation: 'smooth' },
                { time: 3, value: 2, interpolation: 'linear' }
            ]
        }
    ];
    project.clips[clip.id] = clip;
    return validateProject(project);
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('AI-friendly project workspace archives', () => {
    it('exports deterministic standard ZIP entries with readable source and no binary data in the manifest', async () => {
        const project = await richProject();
        const archive = await exportProjectArchive(project);
        const entries = await filesOf(archive);
        const index = manifest(entries);
        expect(archive.type).toBe('application/zip');
        expect(entries[0]?.name).toBe('project.hilo.json');
        expect(index.format).toBe('hilo3d-workspace');
        expect(Object.keys(index.assets)).toEqual(Object.keys(project.assets));
        const asset = Object.values(project.assets)[0];
        if (!asset) throw new Error('Missing test asset');
        expect(decoder.decode(file(entries, 'project.hilo.json').data)).not.toContain(asset.data);
        expect(index.assets[asset.id]).not.toHaveProperty('data');
        expect(index.assets[asset.id]?.source).toEqual(asset.source);
        expect(index.assets[asset.id]?.source.license).toBe('CC0-1.0');
        expect(index.assets[asset.id]?.source.originURL).toBe('https://example.com/materials/clay');
        expect(index.scripts['rotate-script']).not.toHaveProperty('source');
        expect(decoder.decode(file(entries, 'scripts/rotate-script.js').data)).toContain(
            '__hiloArchiveExecuted'
        );
        expect(file(entries, 'project-manifest.schema.json').data.length).toBeGreaterThan(100);
        expect(
            JSON.parse(
                decoder.decode(file(entries, 'project-manifest.schema.json').data)
            ) as unknown
        ).toMatchObject({
            $defs: {
                asset: {
                    properties: {
                        source: {
                            additionalProperties: false,
                            properties: {
                                license: { maxLength: 120 },
                                attribution: { maxLength: 2000 },
                                originURL: { maxLength: 2048 }
                            }
                        }
                    }
                }
            }
        });
        expect(file(entries, 'scene.schema.json').data.length).toBeGreaterThan(100);
        expect(new Uint8Array(await archive.arrayBuffer())).toEqual(
            new Uint8Array(await (await exportProjectArchive(project)).arrayBuffer())
        );
        expect(checksum(encoder.encode('123456789'))).toBe(0xcbf43926);
    });

    it('round trips complete assets, scripts, prefabs, instance baselines and clips without executing source', async () => {
        const project = await richProject();
        const source = structuredClone(project);
        const workers = vi.spyOn(globalThis, 'Worker');
        const restored = await importProjectArchive(await exportProjectArchive(project));
        expect(restored).toEqual(source);
        expect(project).toEqual(source);
        expect(Reflect.get(globalThis, '__hiloArchiveExecuted')).toBeUndefined();
        expect(workers).not.toHaveBeenCalled();
    });

    it('accepts an edited scene and a single Unicode enclosing folder while keeping stable IDs', async () => {
        const project = createProject(createDefaultScene());
        const entries = await filesOf(await exportProjectArchive(project));
        const path = manifest(entries).scenes[project.activeSceneId]?.path;
        if (!path) throw new Error('Missing scene path');
        const scene = JSON.parse(
            decoder.decode(file(entries, path).data)
        ) as ProjectDocument['scenes'][string];
        const node = scene.nodes['hero-sphere'];
        if (!node) throw new Error('Missing sphere');
        node.transform.position.x = 3.25;
        file(entries, path).data = encoder.encode(JSON.stringify(scene));
        const nested = entries.map(entry => ({ ...entry, name: `陶土 工作区/${entry.name}` }));
        nested.unshift({ name: '陶土 工作区/', data: new Uint8Array() });
        const imported = await importProjectArchive(await fixtureZip(nested));
        expect(imported.id).toBe(project.id);
        expect(
            imported.scenes[project.activeSceneId]?.nodes['hero-sphere']?.transform.position.x
        ).toBe(3.25);
    });

    it('imports Deflate and streamed data descriptors and rejects unavailable native decompression clearly', async () => {
        const project = createProject(createDefaultScene());
        const entries = (await filesOf(await exportProjectArchive(project))).map(entry => ({
            ...entry,
            deflate: true,
            descriptor: true
        }));
        const archive = await fixtureZip(entries);
        expect(await importProjectArchive(archive)).toEqual(project);
        const unsigned = await fixtureZip(
            entries.map(entry => ({ ...entry, descriptor: 'unsigned' as const }))
        );
        expect(await importProjectArchive(unsigned)).toEqual(project);
        vi.stubGlobal('DecompressionStream', function unsupportedDecompression(): never {
            throw new TypeError('Format unavailable');
        });
        await expect(importProjectArchive(archive)).rejects.toThrow('stored/uncompressed ZIP');
    });

    it('rejects traversal, absolute paths, Windows aliases, duplicate names and symbolic links', async () => {
        for (const name of [
            '../escape.txt',
            '/escape.txt',
            'C:/escape.txt',
            'scenes\\escape.txt',
            'scenes/../escape.txt',
            'scenes/con.json',
            'scenes/name.'
        ]) {
            await expect(
                importProjectArchive(await fixtureZip([{ name, data: encoder.encode('x') }]))
            ).rejects.toThrow('Unsafe workspace');
        }
        await expect(
            importProjectArchive(
                await fixtureZip([
                    { name: 'same.txt', data: new Uint8Array() },
                    { name: 'SAME.txt', data: new Uint8Array() }
                ])
            )
        ).rejects.toThrow('Duplicate or case-conflicting');
        await expect(
            importProjectArchive(
                await fixtureZip([
                    {
                        name: 'symlink.txt',
                        data: encoder.encode('/outside'),
                        attributes: 0xa1ff0000
                    }
                ])
            )
        ).rejects.toThrow('Symbolic links');
    });

    it('verifies both ZIP CRC and asset SHA even when an archive editor regenerates a valid ZIP checksum', async () => {
        const project = await richProject();
        const archive = await exportProjectArchive(project);
        const bytes = new Uint8Array(await archive.arrayBuffer());
        const view = new DataView(bytes.buffer);
        const manifestStart = 30 + view.getUint16(26, true);
        bytes[manifestStart] = (bytes[manifestStart] ?? 0) ^ 1;
        await expect(importProjectArchive(new Blob([bytes]))).rejects.toThrow('CRC mismatch');
        const entries = await filesOf(archive);
        const asset = Object.values(manifest(entries).assets)[0];
        if (!asset) throw new Error('Missing texture');
        const image = file(entries, asset.path);
        image.data[image.data.length - 1] = (image.data.at(-1) ?? 0) ^ 1;
        await expect(importProjectArchive(await fixtureZip(entries))).rejects.toThrow('checksum');
    });

    it('rejects encrypted, multi-disk and ZIP64 records and mismatched local/central headers', async () => {
        const archive = await exportProjectArchive(createProject(createDefaultScene()));
        const original = new Uint8Array(await archive.arrayBuffer());
        const central = new DataView(original.buffer).getUint32(original.length - 6, true);
        const encrypted = original.slice();
        new DataView(encrypted.buffer).setUint16(central + 8, 0x801, true);
        await expect(importProjectArchive(new Blob([encrypted]))).rejects.toThrow('Encrypted');
        const multiDisk = original.slice();
        new DataView(multiDisk.buffer).setUint16(multiDisk.length - 18, 1, true);
        await expect(importProjectArchive(new Blob([multiDisk]))).rejects.toThrow('Multi-disk');
        const zip64 = original.slice();
        new DataView(zip64.buffer).setUint32(zip64.length - 6, 0xffffffff, true);
        await expect(importProjectArchive(new Blob([zip64]))).rejects.toThrow('ZIP64');
        const mismatch = original.slice();
        mismatch[30] = 'x'.charCodeAt(0);
        await expect(importProjectArchive(new Blob([mismatch]))).rejects.toThrow('paths disagree');
        await expect(
            importProjectArchive(await fixtureZip(await filesOf(archive), encoder.encode('stub')))
        ).rejects.toThrow('hidden or unsupported');
    });

    it('bounds entry counts, declared expansion and actual streamed expansion before materializing the project', async () => {
        const archive = await exportProjectArchive(createProject(createDefaultScene()));
        const tooMany = new Uint8Array(await archive.arrayBuffer());
        const end = new DataView(tooMany.buffer);
        end.setUint16(tooMany.length - 14, 1025, true);
        end.setUint16(tooMany.length - 12, 1025, true);
        await expect(importProjectArchive(new Blob([tooMany]))).rejects.toThrow('1–1024');
        await expect(
            importProjectArchive(
                await fixtureZip([
                    {
                        name: 'oversized.txt',
                        data: new Uint8Array(),
                        declaredSize: 33 * 1024 * 1024
                    }
                ])
            )
        ).rejects.toThrow('expanded data exceeds');
        await expect(
            importProjectArchive(
                await fixtureZip([
                    {
                        name: 'bomb.txt',
                        data: encoder.encode('x'.repeat(100_000)),
                        declaredSize: 1,
                        deflate: true
                    }
                ])
            )
        ).rejects.toThrow('declared size');
        class OversizedBlob extends Blob {
            override get size(): number {
                return 129 * 1024 * 1024;
            }
        }
        await expect(importProjectArchive(new OversizedBlob())).rejects.toThrow('128 MiB');
    });

    it('rejects unknown manifest fields, dangling files, duplicate references and unreferenced payloads', async () => {
        const entries = await filesOf(
            await exportProjectArchive(createProject(createDefaultScene()))
        );
        const index = manifest(entries);
        file(entries, 'project.hilo.json').data = encoder.encode(
            JSON.stringify({ ...index, data: 'not allowed' })
        );
        await expect(importProjectArchive(await fixtureZip(entries))).rejects.toThrow(
            'unknown field'
        );
        updateManifest(entries, index);
        const sceneReference = index.scenes['scene-main'];
        if (!sceneReference) throw new Error('Missing scene');
        index.scenes['scene-copy'] = { ...sceneReference };
        updateManifest(entries, index);
        await expect(importProjectArchive(await fixtureZip(entries))).rejects.toThrow(
            'referenced more than once'
        );
        delete index.scenes['scene-copy'];
        const scenePath = sceneReference.path;
        sceneReference.path = 'scenes/missing.scene.json';
        updateManifest(entries, index);
        await expect(importProjectArchive(await fixtureZip(entries))).rejects.toThrow(
            'file is missing'
        );
        sceneReference.path = scenePath;
        updateManifest(entries, index);
        entries.push({ name: 'unreferenced.bin', data: new Uint8Array([1]) });
        await expect(importProjectArchive(await fixtureZip(entries))).rejects.toThrow(
            'Unreferenced workspace file'
        );
    });

    it('exports Windows-reserved IDs through safe filenames without changing the authored IDs', async () => {
        const project = createProject(createDefaultScene());
        project.scripts['con'] = createScript('con');
        const archive = await exportProjectArchive(project);
        expect(manifest(await filesOf(archive)).scripts['con']?.path).toBe('scripts/_con.js');
        expect((await importProjectArchive(archive)).scripts['con']?.id).toBe('con');
    });
});
