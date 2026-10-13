import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClip } from '../../../editor/animation';
import { assetHash, importAsset } from '../../../editor/assets';
import {
    defaultAudioComponent,
    defaultParticleComponent,
    defaultPhysicsComponent
} from '../../../editor/components';
import { exportPlayerArchive, readDeploymentResponse } from '../../../editor/player-export';
import { createPlayerManifest, validatePlayerManifest } from '../../../editor/player-manifest';
import { createProject, serializeProject, validateProject } from '../../../editor/project';
import { createStoredArchive, importProjectArchive } from '../../../editor/project-archive';
import { createDefaultScene, type SceneNode } from '../../../editor/scene';
import { createScript } from '../../../editor/script-types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base = new URL('https://studio.test/team/editor/player-template/');
const version = '2.0.0-alpha.test';
interface TemplateFixture {
    manifest: {
        format: string;
        version: number;
        engineVersion: string;
        files: { path: string; bytes: number; sha256: string }[];
    };
    files: Map<string, Uint8Array<ArrayBuffer>>;
}
function templateFixture(): TemplateFixture {
    const files = new Map([
        [
            'index.html',
            encoder.encode(
                '<!doctype html><title>Hilo Player</title><script type="module" src="./assets/runtime.js"></script>'
            )
        ],
        ['assets/runtime.js', encoder.encode('document.body.dataset.ready = "true";')],
        ['assets/decoder.wasm', new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])],
        ['LICENSE.txt', encoder.encode('Runtime license')]
    ]);
    return {
        files,
        manifest: {
            format: 'hilo3d-player-template',
            version: 1,
            engineVersion: version,
            files: [...files].map(([path, bytes]) => ({
                path,
                bytes: bytes.length,
                sha256: assetHash(bytes)
            }))
        }
    };
}
function serve(fixture: TemplateFixture): ReturnType<typeof vi.fn<typeof fetch>> {
    const fetcher = vi.fn<typeof fetch>((input, init): Promise<Response> => {
        init?.signal?.throwIfAborted();
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (!url.href.startsWith(base.href))
            throw new Error(`Unexpected external request: ${url.href}`);
        if (url.pathname.endsWith('/template.json'))
            return Promise.resolve(new Response(JSON.stringify(fixture.manifest)));
        const body = fixture.files.get(url.href.slice(base.href.length));
        return Promise.resolve(
            body ? new Response(body) : new Response('Missing', { status: 404 })
        );
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
}
function checksum(data: Uint8Array): number {
    let result = 0xffffffff;
    for (const byte of data) {
        result ^= byte;
        for (let bit = 0; bit < 8; bit += 1)
            result = result & 1 ? (result >>> 1) ^ 0xedb88320 : result >>> 1;
    }
    return (result ^ 0xffffffff) >>> 0;
}
/** Independent stored ZIP inspection checks central directory, local records and payload CRCs. */
async function entries(blob: Blob): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 20, true)).toBe(0);
    const count = view.getUint16(end + 10, true);
    const directoryStart = view.getUint32(end + 16, true);
    const directoryLength = view.getUint32(end + 12, true);
    const result = new Map<string, Uint8Array<ArrayBuffer>>();
    let directory = directoryStart;
    for (let index = 0; index < count; index += 1) {
        expect(view.getUint32(directory, true)).toBe(0x02014b50);
        expect(view.getUint16(directory + 10, true)).toBe(0);
        const size = view.getUint32(directory + 20, true);
        expect(view.getUint32(directory + 24, true)).toBe(size);
        const nameLength = view.getUint16(directory + 28, true);
        const name = decoder.decode(bytes.subarray(directory + 46, directory + 46 + nameLength));
        const local = view.getUint32(directory + 42, true);
        expect(view.getUint32(local, true)).toBe(0x04034b50);
        expect(view.getUint16(local + 6, true)).toBe(0x0800);
        expect(view.getUint16(local + 8, true)).toBe(0);
        expect(view.getUint32(local + 18, true)).toBe(size);
        const localNameLength = view.getUint16(local + 26, true);
        const extraLength = view.getUint16(local + 28, true);
        expect(decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength))).toBe(name);
        const payload = bytes.slice(
            local + 30 + localNameLength + extraLength,
            local + 30 + localNameLength + extraLength + size
        );
        expect(checksum(payload)).toBe(view.getUint32(directory + 16, true));
        expect(checksum(payload)).toBe(view.getUint32(local + 14, true));
        expect(result.has(name)).toBe(false);
        result.set(name, payload);
        directory +=
            46 +
            nameLength +
            view.getUint16(directory + 30, true) +
            view.getUint16(directory + 32, true);
    }
    expect(directory).toBe(directoryStart + directoryLength);
    expect(directory).toBe(end);
    return result;
}
function camera(name: string, visible = true): SceneNode {
    return {
        type: 'camera',
        name,
        parent: null,
        visible,
        transform: {
            position: { x: 0, y: 2, z: 8 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        },
        camera: { fov: 45, near: 0.1, far: 100 }
    };
}
function wave(): File {
    const bytes = new Uint8Array(60);
    const view = new DataView(bytes.buffer);
    bytes.set(encoder.encode('RIFF'), 0);
    view.setUint32(4, bytes.length - 8, true);
    bytes.set(encoder.encode('WAVEfmt '), 8);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    bytes.set(encoder.encode('data'), 36);
    view.setUint32(40, 16, true);
    for (let index = 44; index < bytes.length; index += 2)
        view.setInt16(index, (index - 50) * 2000, true);
    return new File([bytes], 'chime.wav');
}
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('standalone Player settings', () => {
    it('chooses visible cameras and per-scene clips, validates references and returns detached settings', () => {
        const scene = createDefaultScene();
        scene.nodes['camera-hidden'] = camera('Hidden', false);
        scene.nodes['camera-main'] = camera('Main');
        const project = createProject(scene);
        project.scenes['second-scene'] = createDefaultScene();
        const clip = createClip('intro', project.activeSceneId);
        project.clips[clip.id] = clip;
        const manifest = createPlayerManifest(project, version);
        expect(manifest.cameras).toEqual({ [project.activeSceneId]: 'camera-main' });
        expect(manifest.clips).toEqual({ [project.activeSceneId]: 'intro' });
        const result = validatePlayerManifest(manifest, project);
        result.cameras[project.activeSceneId] = 'camera-hidden';
        expect(manifest.cameras[project.activeSceneId]).toBe('camera-main');
        for (const override of [
            { startSceneId: 'absent' },
            { cameras: { [project.activeSceneId]: 'hero-sphere' } },
            { cameras: { missing: 'camera-main' } },
            { clips: { 'second-scene': 'intro' } },
            { clips: { [project.activeSceneId]: 'missing' } },
            { cameras: [] },
            { title: ' ' },
            { showControls: 1 },
            { engineVersion: '' },
            { format: 'other' },
            { version: 2 },
            { execute: 'anything' }
        ])
            expect(() => validatePlayerManifest({ ...manifest, ...override }, project)).toThrow();
    });
});

describe('standalone Player export', () => {
    it('packages exact runtime bytes and an editable component project, keeping names and scripts out of HTML', async () => {
        const project = createProject(createDefaultScene());
        const node = project.scenes[project.activeSceneId]?.nodes['hero-sphere'];
        if (!node) throw new Error('Fixture node missing');
        const sound = await importAsset(wave());
        project.assets[sound.id] = sound;
        node.components = {
            physics: defaultPhysicsComponent(),
            particles: defaultParticleComponent(),
            audio: defaultAudioComponent(sound.id)
        };
        const script = createScript('play-sound');
        script.source = '({start(ctx) { ctx.playAudio(); ctx.emitParticles(4); }})';
        project.scripts[script.id] = script;
        node.scripts = [script.id];
        const valid = validateProject(project);
        const manifest = createPlayerManifest(valid, version);
        manifest.title = '</title><script>window.exportInjection = true</script>';
        const fixture = templateFixture();
        const fetcher = serve(fixture);
        const progress: string[] = [];
        const archive = await exportPlayerArchive(valid, manifest, base, undefined, message => {
            progress.push(message);
        });
        expect(archive.type).toBe('application/zip');
        const files = await entries(archive);
        expect([...files.keys()].sort()).toEqual(
            [...fixture.files.keys(), 'README.md', 'player.json', 'project.zip'].sort()
        );
        for (const [path, data] of fixture.files) expect(files.get(path)).toEqual(data);
        const settings: unknown = JSON.parse(decoder.decode(files.get('player.json')));
        expect(validatePlayerManifest(settings, valid)).toEqual(manifest);
        expect(decoder.decode(files.get('index.html'))).not.toContain(manifest.title);
        expect(decoder.decode(files.get('assets/runtime.js'))).not.toContain(script.source);
        expect(decoder.decode(files.get('README.md'))).toContain('static HTTP(S) host');
        const workspace = files.get('project.zip');
        if (!workspace) throw new Error('Missing project workspace');
        const restored = await importProjectArchive(new Blob([workspace]));
        expect(serializeProject(restored)).toBe(serializeProject(valid));
        expect(restored.assets[sound.id]?.data).toBe(sound.data);
        expect(restored.scenes[restored.activeSceneId]?.nodes['hero-sphere']?.components).toEqual(
            node.components
        );
        expect(fetcher.mock.calls).toHaveLength(1 + fixture.files.size);
        expect(progress.at(-1)).toBe('Creating website ZIP…');
        expect(serializeProject(project)).toBe(serializeProject(valid));
    });

    it('rejects unsafe, reserved, duplicate and missing runtime paths before packaging', async () => {
        const project = createProject(createDefaultScene());
        const settings = createPlayerManifest(project, version);
        for (const path of [
            '../index.html',
            '/index.html',
            'assets/../code.js',
            'assets//code.js',
            'https://elsewhere.test/a.js',
            'player.json',
            'project.zip',
            'README.md',
            'assets/runtime.js'
        ]) {
            const fixture = templateFixture();
            const first = fixture.manifest.files[0];
            if (!first) throw new Error('Missing template entry');
            first.path = path;
            serve(fixture);
            await expect(exportPlayerArchive(project, settings, base)).rejects.toThrow(
                'template file'
            );
        }
        for (const removed of ['index.html', 'assets/runtime.js']) {
            const fixture = templateFixture();
            fixture.manifest.files = fixture.manifest.files.filter(file => file.path !== removed);
            serve(fixture);
            await expect(exportPlayerArchive(project, settings, base)).rejects.toThrow(
                'incomplete'
            );
        }
    });

    it('rejects invalid template byte counts, fingerprints, versions and aggregate size', async () => {
        const project = createProject(createDefaultScene());
        const settings = createPlayerManifest(project, version);
        for (const bytes of [-1, 1.5, 40 * 1024 * 1024 + 1]) {
            const fixture = templateFixture();
            const first = fixture.manifest.files[0];
            if (!first) throw new Error('Missing template entry');
            first.bytes = bytes;
            serve(fixture);
            await expect(exportPlayerArchive(project, settings, base)).rejects.toThrow();
        }
        for (const sha256 of ['', 'a'.repeat(63), 'G'.repeat(64)]) {
            const fixture = templateFixture();
            const first = fixture.manifest.files[0];
            if (!first) throw new Error('Missing template entry');
            first.sha256 = sha256;
            serve(fixture);
            await expect(exportPlayerArchive(project, settings, base)).rejects.toThrow(
                'template file'
            );
        }
        const mismatch = templateFixture();
        mismatch.manifest.engineVersion = 'another-version';
        serve(mismatch);
        await expect(exportPlayerArchive(project, settings, base)).rejects.toThrow(
            'versions differ'
        );
        mismatch.manifest.version = 9;
        await expect(exportPlayerArchive(project, settings, base)).rejects.toThrow(
            'Unsupported Player template'
        );
    });

    it('fails for absent, truncated, oversized or corrupted deployment resources', async () => {
        const project = createProject(createDefaultScene());
        const settings = createPlayerManifest(project, version);
        const missing = templateFixture();
        missing.files.delete('assets/decoder.wasm');
        serve(missing);
        await expect(exportPlayerArchive(project, settings, base)).rejects.toThrow('404');
        for (const change of ['short', 'long', 'corrupt'] as const) {
            const fixture = templateFixture();
            const source = fixture.files.get('assets/runtime.js');
            if (!source) throw new Error('Missing runtime');
            const replacement =
                change === 'short'
                    ? source.slice(0, -1)
                    : change === 'long'
                      ? new Uint8Array(source.length + 1)
                      : source.slice();
            if (change === 'corrupt') replacement[0] = 0;
            fixture.files.set('assets/runtime.js', replacement);
            serve(fixture);
            await expect(exportPlayerArchive(project, settings, base)).rejects.toThrow(
                change === 'long' ? 'byte limit' : 'integrity'
            );
        }
    });

    it('cancels before or during packing without continuing runtime requests', async () => {
        const project = createProject(createDefaultScene());
        const settings = createPlayerManifest(project, version);
        const fetcher = serve(templateFixture());
        const cancelled = new AbortController();
        cancelled.abort();
        await expect(
            exportPlayerArchive(project, settings, base, cancelled.signal)
        ).rejects.toMatchObject({ name: 'AbortError' });
        const controller = new AbortController();
        fetcher.mockClear();
        await expect(
            exportPlayerArchive(project, settings, base, controller.signal, message => {
                if (message.startsWith('Packing runtime 2')) controller.abort();
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetcher.mock.calls).toHaveLength(3);
        expect(fetcher.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
    });

    it('audits complete bytes before invoking the original native body consumer', async () => {
        const expected = new Uint8Array(150_003);
        for (let index = 0; index < expected.length; index++) expected[index] = index % 251;
        let cursor = 0;
        let ended = false;
        const response = new Response(
            new ReadableStream<Uint8Array>({
                pull(controller) {
                    if (cursor === expected.length) {
                        ended = true;
                        controller.close();
                        return;
                    }
                    const end = Math.min(expected.length, cursor + 8191);
                    controller.enqueue(expected.slice(cursor, end));
                    cursor = end;
                }
            })
        );
        const clone = response.clone.bind(response);
        let audited: Response | undefined;
        vi.spyOn(response, 'clone').mockImplementation(() => {
            audited = clone();
            return audited;
        });
        const consume = response.arrayBuffer.bind(response);
        const native = vi.spyOn(response, 'arrayBuffer').mockImplementation(async () => {
            expect(ended).toBe(true);
            expect(response.bodyUsed).toBe(false);
            return consume();
        });
        const bytes = await readDeploymentResponse(response, expected.length);
        expect(native).toHaveBeenCalledTimes(1);
        expect(bytes).toEqual(expected);
        expect(response.bodyUsed).toBe(true);
        // Native consume owns its terminal original body; our explicit audit reader releases its lock.
        expect(audited?.body?.locked).toBe(false);
    });

    it('rejects invalid read budgets before disturbing a response and accepts an empty body', async () => {
        for (const maximum of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            const response = new Response(new Uint8Array([1]));
            const native = vi.spyOn(response, 'arrayBuffer');
            await expect(readDeploymentResponse(response, maximum)).rejects.toThrow('safe integer');
            expect(response.bodyUsed).toBe(false);
            expect(native).not.toHaveBeenCalled();
        }
        expect(await readDeploymentResponse(new Response(new Uint8Array()), 0)).toEqual(
            new Uint8Array()
        );
    });

    it('aborts a blocked audit and cancels both tee branches without waiting for more network bytes', async () => {
        let pulls = 0;
        let cancellations = 0;
        let markPending: () => void = () => undefined;
        const pending = new Promise<void>(resolve => {
            markPending = resolve;
        });
        const response = new Response(
            new ReadableStream<Uint8Array>({
                pull(controller) {
                    pulls++;
                    if (pulls === 1) controller.enqueue(new Uint8Array([1, 2]));
                    else markPending();
                },
                cancel() {
                    cancellations++;
                }
            })
        );
        const native = vi.spyOn(response, 'arrayBuffer');
        const controller = new AbortController();
        const reading = readDeploymentResponse(response, 10, controller.signal);
        const rejection = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
        await pending;
        controller.abort();
        await rejection;
        expect(cancellations).toBe(1);
        expect(native).not.toHaveBeenCalled();
        expect(response.body?.locked).toBe(false);
    });

    it('enforces streamed response budgets without trusting content length and releases readers', async () => {
        let cancelled = 0;
        const response = new Response(
            new ReadableStream<Uint8Array>({
                pull(controller) {
                    controller.enqueue(new Uint8Array(4));
                },
                cancel() {
                    cancelled += 1;
                }
            }),
            { headers: { 'content-length': '1' } }
        );
        const native = vi.spyOn(response, 'arrayBuffer');
        await expect(readDeploymentResponse(response, 5)).rejects.toThrow('byte limit');
        expect(native).not.toHaveBeenCalled();
        expect(cancelled).toBe(1);
        expect(response.body?.locked).toBe(false);
        const controller = new AbortController();
        const aborted = new Response(
            new ReadableStream<Uint8Array>({
                pull(stream) {
                    stream.enqueue(new Uint8Array(1));
                    controller.abort();
                }
            })
        );
        await expect(readDeploymentResponse(aborted, 10, controller.signal)).rejects.toMatchObject({
            name: 'AbortError'
        });
        await expect(
            readDeploymentResponse(new Response(null, { status: 204 }), 5)
        ).rejects.toThrow('204');
    });
});

describe('bounded deployment ZIP writer', () => {
    it('round trips byte-exact content and rejects unsafe paths and exceeded caller limits', async () => {
        const payloads = new Map([
            ['index.html', encoder.encode('Hello')],
            ['assets/code.js', encoder.encode('export {};')]
        ]);
        expect(await entries(createStoredArchive(payloads))).toEqual(payloads);
        for (const path of [
            '../escape',
            '/absolute',
            'a/../escape',
            'CON.txt',
            'a\\file',
            'a//file'
        ])
            expect(() => createStoredArchive(new Map([[path, new Uint8Array(1)]]))).toThrow('path');
        expect(() => createStoredArchive(payloads, { entryBytes: 4, expandedBytes: 100 })).toThrow(
            'size limit'
        );
        expect(() => createStoredArchive(payloads, { entryBytes: 100, expandedBytes: 6 })).toThrow(
            'size limit'
        );
        expect(() =>
            createStoredArchive(payloads, {
                entryBytes: Number.POSITIVE_INFINITY,
                expandedBytes: 100
            })
        ).toThrow('size limits');
        expect(() => createStoredArchive(new Map())).toThrow('entries');
    });
});
