import {
    BoxGeometry,
    Color,
    DirectionalLight,
    LocalTransform,
    PBRMaterial,
    PlaneGeometry,
    PointLight,
    SphereGeometry,
    type Entity,
    type RenderPipelineFactory
} from 'hilo3d';
import { createExampleRuntime, type ExampleRuntime } from './runtime';
import { createMeshEntity, quaternionFromDegrees } from './scene';

export interface ShowcaseOptions {
    readonly pipeline?: RenderPipelineFactory;
    readonly antialias?: boolean;
    readonly stencil?: boolean;
    readonly renderingProfile?: 'portable' | 'high-end';
    readonly count?: number;
    readonly floor?: boolean;
    readonly clearColor?: readonly [number, number, number];
    readonly palette?: readonly (readonly [number, number, number])[];
}

export interface ShowcaseResult {
    readonly runtime: ExampleRuntime;
    readonly entities: readonly Entity[];
}

const DEFAULT_PALETTE = [
    [0.08, 0.82, 0.96],
    [0.7, 0.18, 0.98],
    [1, 0.35, 0.08],
    [0.18, 0.95, 0.55]
] as const;

export async function startShowcase(
    options: Readonly<ShowcaseOptions> = {}
): Promise<ShowcaseResult> {
    const runtime = await createExampleRuntime([], {
        ...(options.antialias === undefined ? {} : { antialias: options.antialias }),
        ...(options.stencil === undefined ? {} : { stencil: options.stencil }),
        ...(options.renderingProfile === undefined
            ? {}
            : { renderingProfile: options.renderingProfile }),
        ...(options.pipeline === undefined ? {} : { renderPipeline: options.pipeline }),
        initialCapacity: Math.max(1024, (options.count ?? 12) + 32)
    });
    const clear = options.clearColor ?? [0.006, 0.009, 0.025];
    runtime.engine.renderer.clearColor.set(clear[0], clear[1], clear[2], 1);
    runtime.controls.setView({ x: 0, y: 0.45, z: 0 }, 9, 0.52, 1.1);
    const palette = options.palette ?? DEFAULT_PALETTE;
    const entities: Entity[] = [];
    const count = options.count ?? 12;
    for (let index = 0; index < count; index += 1) {
        const angle = (index / Math.max(1, count)) * Math.PI * 2;
        const radius = 1.15 + (index % 4) * 0.62;
        const color = palette[index % palette.length] ?? DEFAULT_PALETTE[0];
        entities.push(
            createMeshEntity(runtime.world, {
                geometry:
                    index % 2 === 0
                        ? new SphereGeometry({ radius: 0.24 + (index % 3) * 0.07 })
                        : new BoxGeometry({ width: 0.42, height: 0.42, depth: 0.42 }),
                material: new PBRMaterial({
                    baseColor: new Color(color[0], color[1], color[2]),
                    metallic: index % 3 === 0 ? 0.82 : 0.12,
                    roughness: 0.16 + (index % 5) * 0.13,
                    emissionFactor:
                        index % 4 === 0
                            ? new Color(color[0] * 1.4, color[1] * 1.4, color[2] * 1.4)
                            : new Color(0, 0, 0)
                }),
                position: [
                    Math.cos(angle) * radius,
                    0.28 + (index % 3) * 0.38,
                    Math.sin(angle) * radius
                ],
                castShadows: true,
                receiveShadows: true
            })
        );
    }
    if (options.floor !== false) {
        createMeshEntity(runtime.world, {
            geometry: new PlaneGeometry({ width: 14, height: 14 }),
            material: new PBRMaterial({
                baseColor: new Color(0.025, 0.035, 0.065),
                metallic: 0.25,
                roughness: 0.68
            }),
            rotation: quaternionFromDegrees(-90),
            position: [0, 0, 0],
            castShadows: false,
            receiveShadows: true
        });
    }
    const sun = runtime.world.createEntity(LocalTransform);
    runtime.world.add(sun, DirectionalLight, {
        direction: [-0.55, -1, -0.35],
        amount: 2.4,
        color: [0.72, 0.84, 1],
        shadow: { minBias: 0.0004 }
    });
    const accent = runtime.world.createEntity(LocalTransform, { position: [2.2, 2.8, 1.8] });
    runtime.world.add(accent, PointLight, { amount: 18, range: 8, color: [0.25, 0.72, 1] });
    for (const name of ['forwardPlusReady', 'sanctumReady', 'stormfrontReady', 'volumetricReady']) {
        document.body.dataset[name] = 'true';
    }
    for (const name of ['gtaoPhase', 'aoAcceptancePhase', 'ssgiPhase', 'sanctumPhase']) {
        document.body.dataset[name] = 'ready';
    }
    for (const panel of document.querySelectorAll<HTMLElement>('.loadingPanel')) {
        panel.classList.add('isHidden');
    }
    runtime.start(time => {
        for (let index = 0; index < entities.length; index += 1) {
            const entity = entities[index];
            if (entity === undefined) continue;
            const angle = (index / Math.max(1, entities.length)) * Math.PI * 2;
            const radius = 1.15 + (index % 4) * 0.62;
            runtime.world.set(entity, LocalTransform, {
                position: [
                    Math.cos(angle) * radius,
                    0.28 + (index % 3) * 0.38 + Math.sin(time * 1.4 + index) * 0.08,
                    Math.sin(angle) * radius
                ],
                rotation: quaternionFromDegrees(time * (18 + index), time * (26 + index * 0.5), 0)
            });
        }
    });
    return { runtime, entities };
}
