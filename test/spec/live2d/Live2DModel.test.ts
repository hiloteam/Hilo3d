import { describe, expect, it, vi } from 'vitest';
import { Color, Node, OrthographicCamera, Renderer, Stage } from 'hilo3d';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import { configureLive2D } from '../../../addon-live2d/src/Live2DConfiguration';
import { Live2DModel } from '../../../addon-live2d/src/Live2DModel';
import type { Live2DAssets } from '../../../addon-live2d/src/Live2DAssets';
import type { Live2DDrawable, Live2DSource } from '../../../addon-live2d/src/Live2DSource';
import type {
    Live2DModelRuntime,
    Live2DParameterAccess,
    Live2DParameterBlend,
    Live2DRuntime,
    Live2DRuntimeCreateOptions,
    Live2DUpdateOptions
} from '../../../addon-live2d/src/runtime/Live2DRuntime';

const modelUrl = 'https://model.test/yui.model3.json';

function at<T>(values: readonly T[], index: number): T {
    const value = values[index];
    if (value === undefined) throw new Error('Missing test fixture entry');
    return value;
}

function deferred<T>() {
    let accept: ((value: T) => void) | undefined;
    let fail: ((reason: unknown) => void) | undefined;
    const promise = new Promise<T>((resolve, reject) => {
        accept = resolve;
        fail = reject;
    });
    return {
        promise,
        resolve(value: T): void {
            if (!accept) throw new Error('Uninitialized deferred');
            accept(value);
        },
        reject(reason: unknown): void {
            if (!fail) throw new Error('Uninitialized deferred');
            fail(reason);
        }
    };
}

async function imageBlob(mask: boolean): Promise<Blob> {
    const canvas = new OffscreenCanvas(2, 2);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable');
    context.fillStyle = mask ? '#ffffff' : '#ff0000';
    context.fillRect(0, 0, 2, mask ? 1 : 2);
    return canvas.convertToBlob();
}

async function mockAssets() {
    const [art, mask] = await Promise.all([imageBlob(false), imageBlob(true)]);
    const nativeFetch = globalThis.fetch.bind(globalThis);
    return vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url === modelUrl)
                return Promise.resolve(
                    Response.json({
                        Version: 3,
                        FileReferences: { Moc: 'yui.moc3', Textures: ['art.png', 'mask.png'] },
                        HitAreas: [{ Id: 'art', Name: 'Body' }]
                    })
                );
            if (url.endsWith('.moc3')) return Promise.resolve(new Response(new Uint8Array([1])));
            if (url.endsWith('art.png')) return Promise.resolve(new Response(art));
            if (url.endsWith('mask.png')) return Promise.resolve(new Response(mask));
            if (url.startsWith('https://model.test/'))
                return Promise.resolve(new Response(null, { status: 404 }));
            return nativeFetch(input, init);
        });
}

function drawable(id: string, textureIndex: number): Live2DDrawable {
    return {
        id,
        textureIndex,
        positions: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        opacity: 1,
        renderOrder: 0,
        visible: true,
        doubleSided: true,
        blendMode: 'normal',
        masks: [],
        invertedMask: false,
        multiplyColor: new Float32Array([1, 1, 1, 1]),
        screenColor: new Float32Array(4)
    };
}

class Session implements Live2DModelRuntime {
    readonly parameters = [{ id: 'X', index: 0, min: -1, max: 1, defaultValue: 0 }];
    readonly source: Live2DSource;
    readonly art = drawable('art', 0);
    readonly calls: { delta: number; options: Live2DUpdateOptions }[] = [];
    readonly assets: Live2DAssets;
    readonly destroyed = vi.fn();
    readonly written = vi.fn();
    readonly access: Live2DParameterAccess;
    playing = false;
    expression = false;
    value = 0;
    baseline = 0;
    time = 0;
    opacity = 1;
    throwOnDestroy = false;
    constructor(assets: Live2DAssets) {
        this.assets = assets;
        const mask = drawable('mask', 1);
        mask.visible = false;
        this.art.masks = [0];
        this.source = {
            drawables: [mask, this.art],
            sync(): void {
                /* Frames are set by update. */
            }
        };
        this.access = {
            get: id => this.getParameter(id),
            set: (id, value, weight = 1): void => {
                this.write(id, value, weight, 'overwrite');
            },
            add: (id, value, weight = 1): void => {
                this.write(id, value, weight, 'add');
            },
            multiply: (id, value, weight = 1): void => {
                this.write(id, value, weight, 'multiply');
            }
        };
    }
    private write(id: string, value: number, weight: number, blend: Live2DParameterBlend): void {
        if (id !== 'X') throw new Error('Unknown parameter');
        if (blend === 'overwrite') this.value = this.value * (1 - weight) + value * weight;
        else if (blend === 'add') this.value += value * weight;
        else this.value *= 1 + (value - 1) * weight;
    }
    getParameter(id: string): number {
        if (id !== 'X') throw new Error('Unknown parameter');
        return this.value;
    }
    setParameter(
        id: string,
        value: number,
        weight = 1,
        blend: Live2DParameterBlend = 'overwrite'
    ): void {
        this.written();
        this.write(id, value, weight, blend);
        this.baseline = this.value;
    }
    update(delta: number, options: Live2DUpdateOptions): void {
        this.calls.push({ delta, options: { ...options } });
        this.time += delta;
        this.value = this.playing ? 0.5 : this.baseline;
        options.beforeExpressions?.(this.access, delta);
        if (this.expression) this.value += 0.25;
        options.afterExpressions?.(this.access, delta);
        options.afterEffects?.(this.access, delta);
        const initial = [-1, -1, 1, -1, 1, 1, -1, 1];
        for (let index = 0; index < initial.length; index++)
            this.art.positions[index] = at(initial, index) + (index % 2 === 0 ? this.value : 0);
    }
    playMotion(): boolean {
        this.playing = true;
        return true;
    }
    isMotionPlaying(): boolean {
        return this.playing;
    }
    stopMotions(): void {
        this.playing = false;
    }
    setExpression(): void {
        this.expression = true;
    }
    clearExpression(): void {
        this.expression = false;
    }
    getOpacity(): number {
        return this.opacity;
    }
    destroy(): void {
        this.destroyed();
        if (this.throwOnDestroy) throw new Error('session destroy failed');
    }
}

function runtimeFixture(
    create?: (session: Session, options: Live2DRuntimeCreateOptions) => Promise<Live2DModelRuntime>
) {
    const sessions: Session[] = [];
    const runtime: Live2DRuntime = {
        apiVersion: 1,
        createModel: vi.fn(
            (
                assets: Live2DAssets,
                options: Live2DRuntimeCreateOptions
            ): Promise<Live2DModelRuntime> => {
                const session = new Session(assets);
                sessions.push(session);
                return create ? create(session, options) : Promise.resolve(session);
            }
        )
    };
    return { runtime, sessions };
}

function expectReleased(session: Session): void {
    expect(session.destroyed).toHaveBeenCalledTimes(1);
    for (const texture of session.assets.textures) {
        expect(texture.image).toBeInstanceOf(ImageBitmap);
        expect((texture.image as ImageBitmap).width).toBe(0);
    }
}

describe('Live2DModel production ownership and automatic scene updates', () => {
    it('forwards the explicit deployment asset version to manifest and asset loading', async () => {
        const fetch = await mockAssets();
        const serve = fetch.getMockImplementation();
        if (!serve) throw new Error('Asset server fixture is missing');
        fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : String(input));
            url.searchParams.delete('hilo_v');
            return serve(url.href, init);
        });
        const fixture = runtimeFixture();
        const model = await Live2DModel.load(modelUrl, {
            runtime: fixture.runtime,
            assetVersion: 'body-v6'
        });
        try {
            expect(model.settings.modelUrl).toBe(`${modelUrl}?hilo_v=body-v6`);
            expect(
                fetch.mock.calls.map(call =>
                    new URL(
                        call[0] instanceof Request ? call[0].url : String(call[0])
                    ).searchParams.get('hilo_v')
                )
            ).toEqual(['body-v6', 'body-v6', 'body-v6', 'body-v6']);
            expect(
                at(fixture.sessions, 0).assets.settings.textureUrls.every(
                    url => new URL(url).searchParams.get('hilo_v') === 'body-v6'
                )
            ).toBe(true);
        } finally {
            model.destroy();
        }
    });
    it('deduplicates configured provider initialization while keeping sessions independent', async () => {
        await mockAssets();
        const { runtime, sessions } = runtimeFixture();
        const initialization = deferred<Live2DRuntime>();
        const initialize = vi.fn(() => initialization.promise);
        configureLive2D({ runtime: initialize });
        const firstTask = Live2DModel.load(modelUrl);
        const secondTask = Live2DModel.load(modelUrl);
        await Promise.resolve();
        expect(initialize).toHaveBeenCalledTimes(1);
        initialization.resolve(runtime);
        const [first, second] = await Promise.all([firstTask, secondTask]);
        expect(sessions).toHaveLength(2);
        first.destroy();
        second.advance(10);
        expect(sessions.filter(session => session.destroyed.mock.calls.length === 1)).toHaveLength(
            1
        );
        expect(
            sessions.filter(
                session => session.destroyed.mock.calls.length === 0 && session.calls.length === 1
            )
        ).toHaveLength(1);
        second.destroy();
        for (const session of sessions) expectReleased(session);
    });

    it('keeps shared initialization alive when one model load is cancelled', async () => {
        await mockAssets();
        const fixture = runtimeFixture();
        const initialization = deferred<Live2DRuntime>();
        const initialize = vi.fn(() => initialization.promise);
        configureLive2D({ runtime: initialize });
        const controller = new AbortController();
        const cancelled = Live2DModel.load(modelUrl, { signal: controller.signal });
        const retained = Live2DModel.load(modelUrl);
        controller.abort();
        await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
        initialization.resolve(fixture.runtime);
        const model = await retained;
        expect(initialize).toHaveBeenCalledTimes(1);
        expect(fixture.sessions).toHaveLength(1);
        model.destroy();
        expectReleased(at(fixture.sessions, 0));
    });

    it('publishes initialization before a provider factory starts another model load', async () => {
        await mockAssets();
        const fixture = runtimeFixture();
        const nested: { pending: Promise<Live2DModel> | null } = { pending: null };
        const initialize = vi.fn(() => {
            nested.pending = Live2DModel.load(modelUrl);
            return fixture.runtime;
        });
        configureLive2D({ runtime: initialize });
        const first = await Live2DModel.load(modelUrl);
        if (nested.pending === null) throw new Error('Nested load did not start');
        const second = await nested.pending;
        expect(initialize).toHaveBeenCalledTimes(1);
        first.destroy();
        second.destroy();
        expect(fixture.sessions).toHaveLength(2);
        for (const session of fixture.sessions) expectReleased(session);
    });

    it('retries failed or hung shared factories without accepting a late stale provider', async () => {
        await mockAssets();
        const old = runtimeFixture();
        const current = runtimeFixture();
        const pending = deferred<Live2DRuntime>();
        let calls = 0;
        configureLive2D({
            timeoutMilliseconds: 50,
            runtime: () => {
                calls++;
                return calls === 1 ? pending.promise : current.runtime;
            }
        });
        await expect(Live2DModel.load(modelUrl)).rejects.toMatchObject({ name: 'TimeoutError' });
        const recovered = await Live2DModel.load(modelUrl, { timeoutMilliseconds: 1000 });
        pending.resolve(old.runtime);
        await pending.promise;
        const next = await Live2DModel.load(modelUrl);
        expect(calls).toBe(2);
        expect(old.sessions).toHaveLength(0);
        recovered.destroy();
        next.destroy();
        configureLive2D({
            runtime: vi
                .fn()
                .mockRejectedValueOnce(new Error('provider failed'))
                .mockResolvedValue(current.runtime)
        });
        await expect(Live2DModel.load(modelUrl)).rejects.toThrow('provider failed');
        const retry = await Live2DModel.load(modelUrl);
        retry.destroy();
    });

    it('snapshots configuration across concurrent loads and supports an ESM provider URL', async () => {
        await mockAssets();
        const first = runtimeFixture();
        const second = runtimeFixture();
        const pending = deferred<Live2DRuntime>();
        configureLive2D({ runtime: () => pending.promise });
        const loading = Live2DModel.load(modelUrl);
        configureLive2D({ runtime: second.runtime });
        pending.resolve(first.runtime);
        const oldModel = await loading;
        const newModel = await Live2DModel.load(modelUrl);
        expect(first.sessions).toHaveLength(1);
        expect(second.sessions).toHaveLength(1);
        oldModel.destroy();
        newModel.destroy();
        const moduleUrl = URL.createObjectURL(
            new Blob(
                [
                    `export function createLive2DRuntime(options) { if(options.nonce !== 'example') throw new Error('nonce missing'); return { apiVersion:1, createModel(){return Promise.reject(new Error('module provider called'));} }; }`
                ],
                { type: 'text/javascript' }
            )
        );
        try {
            configureLive2D({ runtimeUrl: moduleUrl, nonce: 'example' });
            await expect(Live2DModel.load(modelUrl)).rejects.toThrow('module provider called');
        } finally {
            URL.revokeObjectURL(moduleUrl);
        }
    });

    it('rejects pre-abort and invalid deadlines before starting a provider', async () => {
        const fetch = await mockAssets();
        const initialize = vi.fn(() => runtimeFixture().runtime);
        configureLive2D({ runtime: initialize });
        const controller = new AbortController();
        controller.abort();
        await expect(
            Live2DModel.load(modelUrl, { signal: controller.signal })
        ).rejects.toMatchObject({ name: 'AbortError' });
        await expect(Live2DModel.load(modelUrl, { timeoutMilliseconds: 0 })).rejects.toThrow(
            'timeoutMilliseconds'
        );
        await expect(Live2DModel.load(modelUrl, { assetVersion: '' })).rejects.toThrow(
            'assetVersion'
        );
        await expect(
            Live2DModel.load(modelUrl, { runtime: null as unknown as Live2DRuntime })
        ).rejects.toThrow('provider API');
        expect(initialize).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('cancels asset loading and observes a late fetch response without constructing SDK resources', async () => {
        const response = deferred<Response>();
        vi.spyOn(globalThis, 'fetch').mockImplementation(() => response.promise);
        const fixture = runtimeFixture();
        const controller = new AbortController();
        const loading = Live2DModel.load(modelUrl, {
            runtime: fixture.runtime,
            signal: controller.signal
        });
        controller.abort();
        await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
        response.resolve(Response.json({ Version: 3 }));
        await response.promise;
        expect(fixture.sessions).toHaveLength(0);
    });

    it('cleans up timed-out SDK sessions when they resolve late and removes abort listeners promptly', async () => {
        await mockAssets();
        const pending = deferred<Live2DModelRuntime>();
        let observedSignal: AbortSignal | undefined;
        let assertListenerCleanup = (): void => {
            throw new Error('Session never received its abort signal');
        };
        const fixture = runtimeFixture((_session, options) => {
            observedSignal = options.signal;
            if (!observedSignal) throw new Error('Missing session abort signal');
            const added = vi.spyOn(observedSignal, 'addEventListener');
            const removed = vi.spyOn(observedSignal, 'removeEventListener');
            assertListenerCleanup = (): void => {
                expect(added).toHaveBeenCalledTimes(1);
                expect(removed).toHaveBeenCalledTimes(1);
            };
            return pending.promise;
        });
        await expect(
            Live2DModel.load(modelUrl, { runtime: fixture.runtime, timeoutMilliseconds: 50 })
        ).rejects.toMatchObject({ name: 'TimeoutError' });
        expect(observedSignal?.aborted).toBe(true);
        assertListenerCleanup();
        const session = at(fixture.sessions, 0);
        expect(session.destroyed).not.toHaveBeenCalled();
        pending.resolve(session);
        await pending.promise;
        await Promise.resolve();
        expectReleased(session);
    });

    it('observes immediate SDK rejection even when the provider aborts synchronously', async () => {
        await mockAssets();
        const controller = new AbortController();
        const fixture = runtimeFixture(() => {
            controller.abort();
            return Promise.reject(new Error('SDK also rejected'));
        });
        await expect(
            Live2DModel.load(modelUrl, { runtime: fixture.runtime, signal: controller.signal })
        ).rejects.toMatchObject({ name: 'AbortError' });
        await Promise.resolve();
        for (const texture of at(fixture.sessions, 0).assets.textures)
            expect((texture.image as ImageBitmap).width).toBe(0);
    });

    it('releases assets and sessions if constructing the scene node fails', async () => {
        await mockAssets();
        const fixture = runtimeFixture(session => {
            session.art.textureIndex = 99;
            return Promise.resolve(session);
        });
        await expect(Live2DModel.load(modelUrl, { runtime: fixture.runtime })).rejects.toThrow(
            'missing texture'
        );
        expectReleased(at(fixture.sessions, 0));
    });

    it('rechecks cancellation after construction and releases the complete node exactly once', async () => {
        await mockAssets();
        const controller = new AbortController();
        const fixture = runtimeFixture(session => {
            session.source.sync = (): void => {
                controller.abort();
            };
            return Promise.resolve(session);
        });
        await expect(
            Live2DModel.load(modelUrl, { runtime: fixture.runtime, signal: controller.signal })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expectReleased(at(fixture.sessions, 0));
    });

    it('applies overrides after hooks without changing the animation baseline and preserves paused clocks', async () => {
        await mockAssets();
        const fixture = runtimeFixture();
        const model = await Live2DModel.load(modelUrl, { runtime: fixture.runtime });
        const session = at(fixture.sessions, 0);
        model.timeScale = 2;
        model.motionTimeScale = 3;
        model.beforeExpressions = access => {
            access.add('X', 0.1);
        };
        model.afterExpressions = access => {
            access.add('X', 0.2);
        };
        model.setExpression('smile');
        model.setParameter('X', 0.9);
        expect(model.getParameter('X')).toBe(0);
        model.advance(100);
        expect(model.getParameter('X')).toBeCloseTo(0.9);
        expect(session.written).not.toHaveBeenCalled();
        expect(at(session.calls, 0).delta).toBe(0.2);
        expect(at(session.calls, 0).options.motionTimeScale).toBe(3);
        model.paused = true;
        model.setParameter('X', -0.4);
        model.advance(500);
        expect(session.time).toBe(0.2);
        expect(model.getParameter('X')).toBeCloseTo(-0.4);
        model.clearParameter('X');
        model.advance(10);
        expect(model.getParameter('X')).toBeCloseTo(0.55);
        model.clearExpression();
        model.beforeExpressions = model.afterExpressions = null;
        model.advance(0);
        expect(model.getParameter('X')).toBe(0);
        expect(model.isMotionPlaying).toBe(false);
        model.playMotion('Idle');
        expect(model.isMotionPlaying).toBe(true);
        model.stopMotions();
        expect(model.isMotionPlaying).toBe(false);
        expect(model.getModelBounds()).toEqual({ left: -1, right: 1, bottom: -1, top: 1 });
        expect(model.hitTest(0, 0, 'Body')).toBe(true);
        expect(model.hitTest(2, 0, 'Body')).toBe(false);
        model.destroy();
        expectReleased(session);
    });

    it('rejects reentrant update/destruction from parameter hooks before releasing ownership', async () => {
        await mockAssets();
        const fixture = runtimeFixture();
        const model = await Live2DModel.load(modelUrl, { runtime: fixture.runtime });
        model.beforeExpressions = (): void => {
            model.destroy();
        };
        expect(() => {
            model.advance(10);
        }).toThrow('parameter update hook');
        expect(model.isDestroyed).toBe(false);
        expect(at(fixture.sessions, 0).destroyed).not.toHaveBeenCalled();
        model.beforeExpressions = (): void => {
            model.advance(0);
        };
        expect(() => {
            model.advance(10);
        }).toThrow('re-entered');
        model.beforeExpressions = null;
        model.advance(10);
        model.destroy();
        expectReleased(at(fixture.sessions, 0));
    });

    it('rejects invalid and foreign renderers without losing model ownership', async () => {
        await mockAssets();
        const fixture = runtimeFixture();
        const model = await Live2DModel.load(modelUrl, { runtime: fixture.runtime });
        expect(() => {
            model.destroy({} as Renderer);
        }).toThrow('Renderer instance');
        const owner = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8
        });
        const other = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8
        });
        try {
            model.prepare(owner);
            expect(() => {
                model.destroy(other);
            }).toThrow('different renderer');
            expect(model.isDestroyed).toBe(false);
            expect(at(fixture.sessions, 0).destroyed).not.toHaveBeenCalled();
            model.destroy(owner);
            expectReleased(at(fixture.sessions, 0));
        } finally {
            model.destroy();
            owner.destroy();
            other.destroy();
        }
    });

    it('finishes user child hierarchies after a destroy override throws before super', async () => {
        await mockAssets();
        const fixture = runtimeFixture();
        const model = await Live2DModel.load(modelUrl, { runtime: fixture.runtime });
        class FailingChild extends Node {
            override destroy(): this {
                throw new Error('child cleanup failed');
            }
        }
        const child = new FailingChild();
        const grandchild = new Node();
        const cleanup = vi.spyOn(grandchild, 'destroy');
        child.addChild(grandchild);
        model.addChild(child);
        const drawableNode = model.children.find(value => value.isMesh);
        if (!drawableNode) throw new Error('Missing owned drawable');
        const attachment = new Node();
        const attachmentCleanup = vi.spyOn(attachment, 'destroy');
        drawableNode.addChild(attachment);
        expect(() => model.destroy()).toThrow('cleanup failed');
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(attachmentCleanup).toHaveBeenCalledTimes(1);
        expect(child.parent).toBeNull();
        expect(grandchild.parent).toBeNull();
        expect(attachment.parent).toBeNull();
        expectReleased(at(fixture.sessions, 0));
        model.destroy();
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('destroys never-rendered nested models and siblings exactly once despite one SDK failure', async () => {
        await mockAssets();
        const fixture = runtimeFixture();
        const models = await Promise.all(
            [0, 1, 2].map(() => Live2DModel.load(modelUrl, { runtime: fixture.runtime }))
        );
        const parent = at(models, 0),
            child = at(models, 1),
            sibling = at(models, 2);
        parent.addChild(new Node().addChild(child));
        const stage = await Stage.create({ backend: 'webgl2', width: 8, height: 8 });
        stage.addChild(parent).addChild(sibling);
        at(fixture.sessions, 0).throwOnDestroy = true;
        expect(() => {
            stage.destroy();
        }).toThrow('Stage destruction failed');
        stage.destroy();
        expect(stage.children).toHaveLength(0);
        for (const session of fixture.sessions) expectReleased(session);
    });

    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`advances and renders clipping automatically when attached to Stage on ${backend}`, async () => {
            await mockAssets();
            const fixture = runtimeFixture();
            const model = await Live2DModel.load(modelUrl, {
                runtime: fixture.runtime,
                maskSize: 32
            });
            const camera = new OrthographicCamera({ near: 0.1, far: 10, z: 2 });
            const canvas = document.createElement('canvas');
            const diagnostics = registerRendererDiagnostics(canvas);
            const stage = await Stage.create({
                backend,
                canvas,
                width: 32,
                height: 32,
                pixelRatio: 1,
                camera,
                clearColor: new Color(0, 0, 0, 0),
                antialias: false
            });
            stage.addChild(model);
            const target = stage.renderer.createRenderTarget({ width: 32, height: 32 });
            stage.renderer.setRenderTarget(target);
            const pixel = (data: Uint8Array, x: number, y: number): number[] =>
                Array.from(data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
            const waitForDraw = async (phase: string): Promise<void> => {
                try {
                    await stage.renderer.waitForIdle();
                } catch (cause) {
                    throw new Error(`${backend}: ${phase} submission failed`, { cause });
                }
                expect(
                    diagnostics.snapshot().frame.draws,
                    `${backend}: ${phase} draws`
                ).toBeGreaterThan(0);
            };
            const readFrame = async (phase: string): Promise<Uint8Array> => {
                await waitForDraw(phase);
                try {
                    return (await target.readColorAttachment()).data;
                } catch (cause) {
                    throw new Error(`${backend}: ${phase} readback failed`, { cause });
                }
            };
            try {
                stage.tick(16);
                let data = await readFrame('initial clipping');
                expect(pixel(data, 8, 4)).toEqual([255, 0, 0, 255]);
                expect(pixel(data, 8, 28)).toEqual([0, 0, 0, 0]);
                expect(at(at(fixture.sessions, 0).calls, 0).delta).toBe(0.016);
                model.setParameter('X', -1);
                stage.tick(16);
                data = await readFrame('parameter update');
                expect(pixel(data, 24, 4)).toEqual([0, 0, 0, 0]);
                expect(pixel(data, 8, 4)).toEqual([255, 0, 0, 255]);
                const session = at(fixture.sessions, 0);
                expect(session.source.modelOpacity).toBeUndefined();
                session.opacity = 0.5;
                model.opacity = 0.5;
                stage.tick(16);
                data = await readFrame('combined opacity');
                expect(pixel(data, 8, 4)[3]).toBe(64);
                expect(model.opacity).toBe(0.5);
                expect(session.art.opacity).toBe(1);
                model.automaticUpdate = false;
                stage.tick(16);
                await waitForDraw('automatic update disabled');
                expect(at(fixture.sessions, 0).calls).toHaveLength(3);
            } finally {
                target.destroy();
                stage.destroy();
                unregisterRendererDiagnostics(canvas, diagnostics);
            }
            expectReleased(at(fixture.sessions, 0));
        });
    }
});
