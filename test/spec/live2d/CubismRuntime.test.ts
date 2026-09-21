import { describe, expect, it, vi } from 'vitest';
import { createCubismRuntime } from '../../../addon-live2d/src/cubism/CubismRuntime';
import type {
    CubismExpressionInstance,
    CubismModelInstance,
    CubismMotionInstance,
    CubismMotionManagerInstance,
    CubismSDK
} from '../../../addon-live2d/src/cubism/CubismSDK';
import type { Live2DAssets } from '../../../addon-live2d/src/Live2DAssets';

function at<T>(values: readonly T[], index: number): T {
    const value = values[index];
    if (value === undefined) throw new Error('Test fixture entry missing');
    return value;
}

function bytes(value: unknown): ArrayBuffer {
    return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function assetFixture(layout: Readonly<Record<string, number>> = {}): Live2DAssets {
    return {
        settings: {
            version: 3,
            modelUrl: 'https://runtime.test/model.model3.json',
            mocUrl: 'https://runtime.test/model.moc3',
            textureUrls: [],
            motions: {
                Idle: [
                    {
                        url: 'https://runtime.test/idle.motion3.json',
                        fadeInTime: 0.3,
                        fadeOutTime: 0.4
                    }
                ]
            },
            expressions: [{ name: 'smile', url: 'https://runtime.test/smile.exp3.json' }],
            physicsUrl: 'https://runtime.test/model.physics3.json',
            poseUrl: 'https://runtime.test/model.pose3.json',
            layout,
            hitAreas: [],
            groups: [
                { target: 'Parameter', name: 'EyeBlink', ids: ['Eye'] },
                { target: 'Parameter', name: 'LipSync', ids: ['Mouth'] }
            ]
        },
        model3: bytes({ Version: 3 }),
        moc: bytes('moc'),
        textures: [],
        destroy: vi.fn()
    };
}

function fetchAnimations() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        return Promise.resolve(
            Response.json(
                url.endsWith('motion3.json')
                    ? { Meta: { Loop: true }, Value: 3 }
                    : url.endsWith('exp3.json')
                      ? { Value: 2 }
                      : {}
            )
        );
    });
}

function sdkFixture(onModelCreate?: () => void) {
    const log: string[] = [];
    const allocations: Animation[] = [];
    const models: Model[] = [];
    const motionManagers: MotionManager[] = [];
    const expressionManagers: ExpressionManager[] = [];
    const state = {
        started: false,
        initialized: false,
        starts: 0,
        initializes: 0,
        mocReleases: 0,
        modelReleases: 0,
        physicsDeletes: 0,
        poseDeletes: 0,
        blinkDeletes: 0
    };

    class Animation implements CubismMotionInstance {
        loop = false;
        fadeIn = 1;
        fadeOut = 1;
        releases = 0;
        readonly value: number;
        effectIds: readonly object[][] = [];
        constructor(data: ArrayBuffer) {
            const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
            const value: unknown =
                typeof parsed === 'object' && parsed !== null
                    ? Reflect.get(parsed, 'Value')
                    : undefined;
            this.value = typeof value === 'number' ? value : 0;
            allocations.push(this);
        }
        setLoop(value: boolean): void {
            this.loop = value;
        }
        setFadeInTime(value: number): void {
            this.fadeIn = value;
        }
        setFadeOutTime(value: number): void {
            this.fadeOut = value;
        }
        setEffectIds(eye: object[], lip: object[]): void {
            this.effectIds = [eye, lip];
        }
        release(): void {
            this.releases++;
        }
    }

    class Model implements CubismModelInstance {
        readonly values = new Float32Array([0, 1, 0]);
        readonly saved = this.values.slice();
        opacity = 1;
        readonly raw = {
            parameters: {
                count: 3,
                ids: ['X', 'Eye', 'Mouth'],
                minimumValues: new Float32Array([-10, 0, 0]),
                maximumValues: new Float32Array([10, 1, 1]),
                defaultValues: new Float32Array([0, 1, 0])
            },
            drawables: {
                count: 1,
                ids: ['art'],
                constantFlags: new Uint8Array([4]),
                dynamicFlags: new Uint8Array([1]),
                textureIndices: new Int32Array([0]),
                opacities: new Float32Array([1]),
                maskCounts: new Int32Array([0]),
                masks: [new Int32Array()],
                vertexCounts: new Int32Array([3]),
                vertexPositions: [new Float32Array([0, 0, 1, 0, 0, 1])],
                vertexUvs: [new Float32Array([0, 0, 1, 0, 0, 1])],
                indexCounts: new Int32Array([3]),
                indices: [new Uint16Array([0, 1, 2])],
                multiplyColors: new Float32Array([1, 1, 1, 1]),
                screenColors: new Float32Array(4),
                renderOrders: new Int32Array([0])
            }
        };
        constructor() {
            models.push(this);
            onModelCreate?.();
        }
        getModel(): typeof this.raw {
            return this.raw;
        }
        getCanvasWidth(): number {
            return 2;
        }
        getCanvasHeight(): number {
            return 2;
        }
        loadParameters(): void {
            log.push('load');
            this.values.set(this.saved);
        }
        saveParameters(): void {
            log.push('save');
            this.saved.set(this.values);
        }
        getParameterValueByIndex(index: number): number {
            return this.values[index] ?? 0;
        }
        setParameterValueByIndex(index: number, value: number, weight = 1): void {
            this.values[index] = (this.values[index] ?? 0) * (1 - weight) + value * weight;
        }
        addParameterValueByIndex(index: number, value: number, weight = 1): void {
            this.values[index] = (this.values[index] ?? 0) + value * weight;
        }
        multiplyParameterValueByIndex(index: number, value: number, weight = 1): void {
            this.values[index] = (this.values[index] ?? 0) * (1 + (value - 1) * weight);
        }
        getModelOapcity(): number {
            return this.opacity;
        }
        update(): void {
            log.push('core');
            at(this.raw.drawables.vertexPositions, 0)[0] = this.values[0] ?? 0;
        }
    }

    class Queue {
        readonly active: Animation[] = [];
        released = false;
        autoDelete = true;
        stopAllMotions(): void {
            // Deliberately mimic the official forward-splice behavior so draining is covered.
            for (let index = 0; index < this.active.length; index++) this.active.splice(index, 1);
        }
        getCubismMotionQueueEntries(): { getCubismMotion(): Animation }[] {
            return this.active.map(motion => ({ getCubismMotion: (): Animation => motion }));
        }
        release(): void {
            this.released = true;
        }
        add(animation: CubismExpressionInstance, autoDelete: boolean): object {
            if (!(animation instanceof Animation)) throw new Error('Unexpected SDK animation');
            this.autoDelete = autoDelete;
            this.active.push(animation);
            return {};
        }
    }

    class MotionManager extends Queue {
        priority = 0;
        reserved = 0;
        time = 0;
        isFinished(): boolean {
            return this.active.length === 0;
        }
        constructor() {
            super();
            motionManagers.push(this);
        }
        reserveMotion(priority: number): boolean {
            if (priority <= this.priority || priority <= this.reserved) return false;
            this.reserved = priority;
            return true;
        }
        setReservePriority(priority: number): void {
            this.reserved = priority;
        }
        startMotionPriority(
            motion: CubismMotionInstance,
            autoDelete: boolean,
            priority: number
        ): object {
            this.priority = priority;
            this.reserved = 0;
            return this.add(motion, autoDelete);
        }
        updateMotion(model: CubismModelInstance, delta: number): boolean {
            log.push('motion');
            this.time += delta;
            for (const motion of this.active) model.setParameterValueByIndex(0, motion.value);
            if (this.active.length === 0) this.priority = 0;
            return this.active.length > 0;
        }
    }

    class ExpressionManager extends Queue {
        constructor() {
            super();
            expressionManagers.push(this);
        }
        startMotion(expression: CubismExpressionInstance, autoDelete: boolean): object {
            return this.add(expression, autoDelete);
        }
        updateMotion(model: CubismModelInstance): boolean {
            log.push('expression');
            for (const expression of this.active)
                model.addParameterValueByIndex(0, expression.value);
            return this.active.length > 0;
        }
    }

    class ModelMatrix {
        scale = 5;
        x = 0;
        loadIdentity(): void {
            this.scale = 1;
        }
        setupFromLayout(layout: Map<string, number>): void {
            this.scale = (layout.get('width') ?? 2) / 2;
            this.x = layout.get('x') ?? 0;
        }
        transformX(value: number): number {
            return value * this.scale + this.x;
        }
        transformY(value: number): number {
            return value * this.scale;
        }
    }

    const sdk = {
        Core: {
            Utils: {
                hasBlendAdditiveBit: (flags: number): boolean => (flags & 1) !== 0,
                hasBlendMultiplicativeBit: (flags: number): boolean => (flags & 2) !== 0,
                hasIsDoubleSidedBit: (flags: number): boolean => (flags & 4) !== 0,
                hasIsInvertedMaskBit: (flags: number): boolean => (flags & 8) !== 0,
                hasIsVisibleBit: (flags: number): boolean => (flags & 1) !== 0
            }
        },
        CubismFramework: {
            isStarted: (): boolean => state.started,
            startUp: (): boolean => {
                state.starts++;
                state.started = true;
                return true;
            },
            isInitialized: (): boolean => state.initialized,
            initialize: (): void => {
                state.initializes++;
                state.initialized = true;
            },
            getIdManager: (): { getId(id: string): object } => ({
                getId: (id: string): object => ({ id })
            })
        },
        CubismMoc: {
            create: (_data: ArrayBuffer, consistency: boolean) => {
                expect(consistency).toBe(true);
                return {
                    createModel: (): Model => new Model(),
                    deleteModel: (): void => {
                        state.modelReleases++;
                    },
                    release: (): void => {
                        state.mocReleases++;
                    }
                };
            }
        },
        CubismMotionManager: MotionManager,
        CubismExpressionMotionManager: ExpressionManager,
        CubismModelMatrix: ModelMatrix,
        CubismMotion: {
            create: (
                data: ArrayBuffer,
                _size: number,
                _finished?: undefined,
                _began?: undefined,
                consistency?: boolean
            ): Animation => {
                expect(consistency).toBe(true);
                return new Animation(data);
            }
        },
        CubismExpressionMotion: { create: (data: ArrayBuffer): Animation => new Animation(data) },
        CubismEyeBlink: {
            create: () => ({
                setParameterIds: (_ids: object[]): void => {
                    /* IDs are owned by the SDK. */
                },
                updateParameters: (model: CubismModelInstance): void => {
                    log.push('blink');
                    model.setParameterValueByIndex(1, 0.25);
                }
            }),
            delete: (): void => {
                state.blinkDeletes++;
            }
        },
        CubismPhysics: {
            create: () => ({
                evaluate: (): void => {
                    log.push('physics');
                }
            }),
            delete: (): void => {
                state.physicsDeletes++;
            }
        },
        CubismPose: {
            create: () => ({
                updateParameters: (): void => {
                    log.push('pose');
                }
            }),
            delete: (): void => {
                state.poseDeletes++;
            }
        }
    } satisfies CubismSDK;
    return { sdk, log, state, allocations, models, motionManagers, expressionManagers };
}

describe('Cubism CPU runtime adapter', () => {
    it('checks the SDK namespace and shares initialization while isolating models and clocks', async () => {
        expect(() => createCubismRuntime({})).toThrow('Core');
        fetchAnimations();
        const fixture = sdkFixture();
        const runtime = createCubismRuntime(fixture.sdk);
        const first = await runtime.createModel(assetFixture(), {});
        const second = await runtime.createModel(assetFixture(), {});
        expect(fixture.state.starts).toBe(1);
        expect(fixture.state.initializes).toBe(1);
        first.playMotion('Idle');
        first.update(0.25, { motionTimeScale: 2 });
        expect(at(fixture.motionManagers, 0).time).toBe(0.5);
        expect(at(fixture.motionManagers, 1).time).toBe(0);
        expect(first.getParameter('X')).toBe(3);
        expect(second.getParameter('X')).toBe(0);
        first.destroy();
        second.update(0.1, {});
        expect(fixture.state.initialized).toBe(true);
        second.destroy();
        expect(fixture.state.modelReleases).toBe(2);
        expect(fixture.state.mocReleases).toBe(2);
    });

    it('orders baseline, procedural hooks, expressions and effects without accumulating transient values', async () => {
        fetchAnimations();
        const fixture = sdkFixture();
        const session = await createCubismRuntime(fixture.sdk).createModel(assetFixture(), {});
        session.setParameter('X', 1);
        session.setExpression('smile');
        fixture.log.length = 0;
        const options = {
            lipSync: 0.5,
            beforeExpressions: (): void => {
                fixture.log.push('before');
            },
            afterExpressions: (): void => {
                fixture.log.push('after');
            },
            afterEffects: (): void => {
                fixture.log.push('final');
            }
        };
        session.update(0.1, options);
        expect(fixture.log).toEqual([
            'load',
            'motion',
            'save',
            'blink',
            'before',
            'expression',
            'after',
            'physics',
            'pose',
            'final',
            'core'
        ]);
        expect(session.getParameter('X')).toBe(3);
        expect(session.getParameter('Mouth')).toBe(0.5);
        session.update(0.1, options);
        expect(session.getParameter('X')).toBe(3);
        expect(session.getParameter('Mouth')).toBe(0.5);
        session.clearExpression();
        fixture.log.length = 0;
        session.update(0, {
            automaticEyeBlink: false,
            physicsEnabled: false,
            afterEffects: access => {
                access.add('X', 2);
                access.multiply('X', 2);
                access.set('Eye', 1);
            }
        });
        expect(session.getParameter('X')).toBe(6);
        expect(session.getParameter('Eye')).toBe(1);
        expect(fixture.log).not.toContain('blink');
        expect(fixture.log).not.toContain('physics');
        expect(() => {
            session.setParameter('missing', 0);
        }).toThrow('Unknown Live2D parameter');
        expect(() => {
            session.update(Number.NaN, {});
        }).toThrow('deltaSeconds');
        session.destroy();
    });

    it('supports loop metadata, explicit fade overrides, named priorities and complete stop', async () => {
        fetchAnimations();
        const fixture = sdkFixture();
        const session = await createCubismRuntime(fixture.sdk).createModel(assetFixture(), {});
        expect(session.playMotion('Idle', { priority: 'normal' })).toBe(true);
        expect(session.isMotionPlaying()).toBe(true);
        const first = requireAnimation(fixture.allocations);
        expect(first.loop).toBe(true);
        expect(first.fadeIn).toBe(0.3);
        expect(first.fadeOut).toBe(0.4);
        expect(first.effectIds.map(ids => ids.length)).toEqual([1, 1]);
        expect(session.playMotion('Idle', { priority: 'background' })).toBe(false);
        expect(
            session.playMotion('Idle', { loop: false, fadeInSeconds: 0, fadeOutSeconds: 0.8 })
        ).toBe(true);
        const second = requireAnimation(fixture.allocations);
        expect(second).not.toBe(first);
        expect(second.loop).toBe(false);
        expect(second.fadeIn).toBe(0);
        expect(second.fadeOut).toBe(0.8);
        expect(first.loop).toBe(true);
        expect(session.playMotion('Idle')).toBe(true);
        const manager = at(fixture.motionManagers, 0);
        expect(manager.active).toHaveLength(3);
        expect(manager.autoDelete).toBe(false);
        session.stopMotions();
        expect(session.isMotionPlaying()).toBe(false);
        expect(manager.active).toHaveLength(0);
        expect(manager.released).toBe(true);
        expect(first.releases).toBe(1);
        expect(second.releases).toBe(1);
        expect(session.playMotion('Idle', { priority: 'background' })).toBe(true);
        session.destroy();
        expect(fixture.allocations.every(animation => animation.releases === 1)).toBe(true);
    });

    it('releases expressions removed by SDK fades and drains every remaining expression on clear', async () => {
        fetchAnimations();
        const fixture = sdkFixture();
        const session = await createCubismRuntime(fixture.sdk).createModel(assetFixture(), {});
        session.setExpression('smile', { fadeInSeconds: 0.2, fadeOutSeconds: 0.6 });
        const removed = requireAnimation(fixture.allocations);
        expect(removed.fadeIn).toBe(0.2);
        expect(removed.fadeOut).toBe(0.6);
        at(fixture.expressionManagers, 0).active.length = 0;
        session.update(0, {});
        expect(removed.releases).toBe(1);
        session.setExpression('smile');
        session.setExpression('smile');
        session.setExpression('smile');
        session.clearExpression();
        expect(at(fixture.expressionManagers, 0).active).toHaveLength(0);
        session.destroy();
        expect(fixture.allocations.every(animation => animation.releases === 1)).toBe(true);
    });

    it('honors explicit model3 Layout using reusable buffers and preserves native coordinates otherwise', async () => {
        fetchAnimations();
        const fixture = sdkFixture();
        const runtime = createCubismRuntime(fixture.sdk);
        const native = await runtime.createModel(assetFixture(), {});
        const laidOut = await runtime.createModel(assetFixture({ Width: 4, X: 1 }), {});
        expect(at(native.source.drawables, 0).positions[0]).toBe(0);
        const positions = at(laidOut.source.drawables, 0).positions;
        expect(positions[0]).toBe(1);
        laidOut.setParameter('X', 2);
        laidOut.update(0, {});
        expect(at(laidOut.source.drawables, 0).positions).toBe(positions);
        expect(positions[0]).toBe(5);
        at(fixture.models, 1).opacity = 0.25;
        expect(laidOut.getOpacity()).toBe(0.25);
        expect(laidOut.source.modelOpacity).toBe(0.25);
        expect(at(laidOut.source.drawables, 0).opacity).toBe(1);
        native.destroy();
        laidOut.destroy();
    });

    it('rolls back every model resource on setup failure and never owns input assets', async () => {
        fetchAnimations();
        const fixture = sdkFixture();
        const assets = assetFixture();
        const destroyAssets = vi.spyOn(assets, 'destroy');
        vi.spyOn(fixture.sdk.CubismPose, 'create').mockImplementation(() => {
            throw new Error('pose parse failed');
        });
        await expect(createCubismRuntime(fixture.sdk).createModel(assets, {})).rejects.toThrow(
            'pose parse failed'
        );
        expect(fixture.state).toMatchObject({
            modelReleases: 1,
            mocReleases: 1,
            physicsDeletes: 1,
            blinkDeletes: 1
        });
        expect(at(fixture.motionManagers, 0).released).toBe(true);
        expect(at(fixture.expressionManagers, 0).released).toBe(true);
        expect(destroyAssets).not.toHaveBeenCalled();
    });

    it('cancels eager loading without allocating Core resources', async () => {
        const fetch = fetchAnimations();
        const controller = new AbortController();
        fetch.mockImplementation(() => {
            controller.abort();
            return Promise.resolve(Response.json({}));
        });
        const fixture = sdkFixture();
        await expect(
            createCubismRuntime(fixture.sdk).createModel(assetFixture(), {
                signal: controller.signal
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(fixture.models).toHaveLength(0);
    });

    it('rolls back cancellation raised during SDK construction and releases completed motions', async () => {
        fetchAnimations();
        const controller = new AbortController();
        const aborted = sdkFixture(() => {
            controller.abort();
        });
        await expect(
            createCubismRuntime(aborted.sdk).createModel(assetFixture(), {
                signal: controller.signal
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(aborted.state).toMatchObject({
            modelReleases: 1,
            mocReleases: 1,
            physicsDeletes: 1,
            poseDeletes: 1,
            blinkDeletes: 1
        });
        const fixture = sdkFixture();
        const session = await createCubismRuntime(fixture.sdk).createModel(assetFixture(), {});
        session.playMotion('Idle');
        const completed = requireAnimation(fixture.allocations);
        at(fixture.motionManagers, 0).active.length = 0;
        session.update(0, {});
        expect(completed.releases).toBe(1);
        session.destroy();
        expect(completed.releases).toBe(1);
    });

    it('rejects malformed eager animations and releases model allocations', async () => {
        fetchAnimations();
        const fixture = sdkFixture();
        const sdk: CubismSDK = fixture.sdk;
        vi.spyOn(sdk.CubismMotion, 'create').mockReturnValue(null);
        await expect(createCubismRuntime(sdk).createModel(assetFixture(), {})).rejects.toThrow(
            'parsed motion'
        );
        expect(fixture.state).toMatchObject({
            modelReleases: 1,
            mocReleases: 1,
            physicsDeletes: 1,
            poseDeletes: 1
        });
    });

    it('clears a failed playback reservation and keeps the session usable', async () => {
        fetchAnimations();
        const fixture = sdkFixture();
        const session = await createCubismRuntime(fixture.sdk).createModel(assetFixture(), {});
        const manager: CubismMotionManagerInstance = at(fixture.motionManagers, 0);
        const start = vi.spyOn(manager, 'startMotionPriority').mockReturnValue(-1);
        expect(session.playMotion('Idle', { priority: 'normal' })).toBe(false);
        expect(at(fixture.motionManagers, 0).reserved).toBe(0);
        expect(requireAnimation(fixture.allocations).releases).toBe(1);
        start.mockRestore();
        expect(session.playMotion('Idle', { priority: 'normal' })).toBe(true);
        session.destroy();
    });

    it('finishes destruction after an SDK cleanup failure and rejects stale source updates', async () => {
        fetchAnimations();
        const fixture = sdkFixture();
        const session = await createCubismRuntime(fixture.sdk).createModel(assetFixture(), {});
        const source = session.source;
        vi.spyOn(fixture.sdk.CubismPhysics, 'delete').mockImplementation(() => {
            throw new Error('physics cleanup failed');
        });
        expect(() => {
            session.destroy();
        }).toThrow('runtime cleanup failed');
        expect(fixture.state).toMatchObject({
            modelReleases: 1,
            mocReleases: 1,
            poseDeletes: 1,
            blinkDeletes: 1
        });
        expect(() => {
            source.sync();
        }).toThrow('destroyed');
        expect(() => {
            session.destroy();
        }).not.toThrow();
    });
});

function requireAnimation<T>(allocations: readonly T[]): T {
    return at(allocations, allocations.length - 1);
}
