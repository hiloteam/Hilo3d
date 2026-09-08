import { PHYSICS_WORLD_2D_SERVICE, PHYSICS_WORLD_3D_SERVICE } from '@hilo/addon-physics';
import * as Hilo3d from '../../src/Hilo3d';
import { createExampleContext, type ExampleContext } from '../shared/init';
import { createStudioEnvironmentMaps } from '../shared/studioEnvironment';

interface ExhibitOptions {
    readonly system: Hilo3d.StageSystem;
    readonly floorY?: number;
    readonly mobileDistanceScale?: number;
    readonly chapter: string;
    readonly title: string;
    readonly subtitle: string;
    readonly accent: string;
    readonly camera: readonly [number, number, number];
    readonly target: readonly [number, number, number];
}

export interface ExhibitRuntime extends Pick<
    ExampleContext,
    'stage' | 'camera' | 'ticker' | 'orbitControls'
> {
    readonly material: (color: number, roughness?: number, metallic?: number) => Hilo3d.PBRMaterial;
    readonly box: (
        parent: Hilo3d.Node,
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
        depth: number,
        material: Hilo3d.PBRMaterial
    ) => Hilo3d.Mesh;
    readonly sphere: (
        parent: Hilo3d.Node,
        x: number,
        y: number,
        z: number,
        radius: number,
        material: Hilo3d.PBRMaterial
    ) => Hilo3d.Mesh;
    readonly cylinder: (
        parent: Hilo3d.Node,
        x: number,
        y: number,
        z: number,
        radius: number,
        height: number,
        material: Hilo3d.PBRMaterial
    ) => Hilo3d.Mesh;
    readonly label: (
        parent: Hilo3d.Node,
        text: string,
        x: number,
        y: number,
        z: number,
        width: number,
        color?: string
    ) => Hilo3d.Mesh;
    readonly setMetric: (key: string, label: string, value: string) => void;
    readonly setStatus: (text: string) => void;
    readonly action: (id: string, label: string, callback: () => void) => HTMLButtonElement;
    readonly start: () => void;
}

function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Physics exhibit requires ${selector}`);
    return element;
}

/** Rounded solids retain the requested outer dimensions, matching their physics colliders. */
function roundedBox(width: number, height: number, depth: number): Hilo3d.Geometry {
    const radius = Math.min(0.065, width * 0.12, height * 0.12, depth * 0.12);
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const extents = [width / 2, height / 2, depth / 2] as const;
    const divisions = 6;
    for (const axis of [0, 1, 2] as const) {
        const u = ((axis + 1) % 3) as 0 | 1 | 2;
        const v = ((axis + 2) % 3) as 0 | 1 | 2;
        for (const sign of [-1, 1]) {
            const start = positions.length / 3;
            for (let row = 0; row <= divisions; row++) {
                for (let column = 0; column <= divisions; column++) {
                    const point = [0, 0, 0];
                    point[axis] = sign * extents[axis];
                    const coordinate = (index: number, extent: number): number => {
                        if (index === 0) return -extent;
                        if (index === divisions) return extent;
                        // Concentrate vertices around the bevel and retain a genuinely flat face.
                        // Uniform subdivision spreads the interpolated edge normal across a slab.
                        if (index === 1) return -extent + radius * 0.25;
                        if (index === 2) return -extent + radius;
                        if (index === 4) return extent - radius;
                        if (index === 5) return extent - radius * 0.25;
                        return 0;
                    };
                    point[u] = coordinate(column, extents[u]);
                    point[v] = coordinate(row, extents[v]);
                    const core = point.map((value, index) => {
                        const extent = extents[index] ?? 0;
                        return Math.max(-extent + radius, Math.min(extent - radius, value));
                    });
                    const normal = point.map((value, index) => value - (core[index] ?? 0));
                    const length = Math.hypot(...normal);
                    for (let component = 0; component < 3; component++) {
                        const n = (normal[component] ?? 0) / length;
                        positions.push((core[component] ?? 0) + n * radius);
                        normals.push(n);
                    }
                }
            }
            for (let row = 0; row < divisions; row++) {
                for (let column = 0; column < divisions; column++) {
                    const a = start + row * (divisions + 1) + column;
                    const b = a + 1;
                    const c = a + divisions + 1;
                    if (sign > 0) indices.push(a, b, c, b, c + 1, c);
                    else indices.push(a, c, b, b, c, c + 1);
                }
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function cylinderGeometry(): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const segments = 48;
    const add = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
        positions.push(x, y, z);
        normals.push(nx, ny, nz);
        return positions.length / 3 - 1;
    };
    for (let segment = 0; segment < segments; segment++) {
        const a = (segment / segments) * Math.PI * 2;
        const b = ((segment + 1) / segments) * Math.PI * 2;
        const ca = Math.cos(a),
            sa = Math.sin(a),
            cb = Math.cos(b),
            sb = Math.sin(b);
        const top = add(0, 0.5, 0, 0, 1, 0);
        const ta = add(ca, 0.5, sa, 0, 1, 0);
        const tb = add(cb, 0.5, sb, 0, 1, 0);
        const bottom = add(0, -0.5, 0, 0, -1, 0);
        const ba = add(ca, -0.5, sa, 0, -1, 0);
        const bb = add(cb, -0.5, sb, 0, -1, 0);
        const s0 = add(ca, 0.5, sa, ca, 0, sa);
        const s1 = add(cb, 0.5, sb, cb, 0, sb);
        const s2 = add(ca, -0.5, sa, ca, 0, sa);
        const s3 = add(cb, -0.5, sb, cb, 0, sb);
        indices.push(top, tb, ta, bottom, ba, bb, s0, s1, s3, s0, s3, s2);
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

/** Shared art direction and lifecycle; each exhibit owns its actual physics experiment. */
export async function createPhysicsExhibit(options: ExhibitOptions): Promise<ExhibitRuntime> {
    document.documentElement.style.setProperty('--accent', options.accent);
    requireElement('#chapter').textContent = options.chapter;
    requireElement('#exhibit-title').textContent = options.title;
    requireElement('#exhibit-description').textContent = options.subtitle;
    for (const link of document.querySelectorAll<HTMLAnchorElement>('.chapter-link')) {
        const active = link.dataset['chapter'] === options.chapter;
        if (active) link.setAttribute('aria-current', 'page');
        const url = new URL(link.href);
        const backend = new URL(location.href).searchParams.get('backend');
        if (backend) url.searchParams.set('backend', backend);
        link.href = url.href;
    }
    const context = await createExampleContext({
        camera: {
            x: options.camera[0],
            y: options.camera[1],
            z: options.camera[2],
            fov: 38,
            far: 250
        },
        stage: {
            systems: [options.system],
            useInstanced: true,
            antialias: true,
            pixelRatio: Math.min(devicePixelRatio, 2),
            clearColor: new Hilo3d.Color(0.018, 0.036, 0.039),
            renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
                bloom: false,
                opaqueTexture: false,
                colorUber: {
                    exposure: 0.12,
                    toneMapping: 'pbr-neutral',
                    contrast: 0.035,
                    saturation: -0.025
                }
            })
        },
        controls: {
            target: new Hilo3d.Vector3(...options.target),
            minDistance: 8,
            maxDistance: 80,
            enablePan: true,
            maxPolarAngle: Math.PI * 0.51
        },
        autoStart: false
    });
    const { stage, camera, ticker, orbitControls, directionLight, ambientLight, stats } = context;
    stats.stop();
    stats.container.remove();
    directionLight.direction.set(-0.5, -1, -0.6);
    directionLight.color.set(1, 0.88, 0.72, 1);
    directionLight.amount = 2.4;
    const shadowResolution = devicePixelRatio > 1 ? 2048 : 1024;
    // The manual frustum spans 26 m across and 60 m in depth. Bias in shadow-texel units
    // prevents broad ceramic surfaces from self-shadowing at either display density.
    const shadowTexelDepth = 26 / shadowResolution / 60;
    directionLight.shadow = {
        width: shadowResolution,
        height: shadowResolution,
        minBias: shadowTexelDepth * 1.75,
        maxBias: shadowTexelDepth * 7,
        cameraInfo: { near: -25, far: 35, left: -13, right: 13, top: 13, bottom: -13 },
        shadowStrength: 0.85
    };
    ambientLight.color.set(0.68, 0.83, 0.87, 1);
    ambientLight.amount = 0.28;
    new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(0.56, 0.82, 0.9),
        amount: 1.1,
        direction: new Hilo3d.Vector3(0.7, -0.3, 0.8)
    }).addTo(stage);
    const maps = createStudioEnvironmentMaps();
    const brdfLUT = await new Hilo3d.TextureLoader().load({
        src: new URL('../image/brdfLUT.png', import.meta.url).href
    });
    const materials = new Map<string, Hilo3d.PBRMaterial>();
    const geometries = new Map<string, Hilo3d.Geometry>();
    const sphere = new Hilo3d.SphereGeometry({ radius: 1, widthSegments: 36, heightSegments: 24 });
    const cylinder = cylinderGeometry();
    const metricElements = new Map<string, HTMLElement>();
    const world =
        stage.systems.getOptional(PHYSICS_WORLD_3D_SERVICE) ??
        stage.systems.get(PHYSICS_WORLD_2D_SERVICE);
    const action = (id: string, label: string, callback: () => void): HTMLButtonElement => {
        const button = document.createElement('button');
        button.id = id;
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', callback);
        requireElement('#scene-actions').appendChild(button);
        return button;
    };
    const pause = requireElement('#pause');
    pause.addEventListener('click', () => {
        world.paused = !world.paused;
        pause.textContent = world.paused ? '继续运行' : '暂停';
        pause.setAttribute('aria-pressed', String(world.paused));
        document.body.dataset['paused'] = String(world.paused);
    });
    const slow = requireElement('#slow');
    slow.addEventListener('click', () => {
        world.timeScale = world.timeScale === 1 ? 0.25 : 1;
        slow.setAttribute('aria-pressed', String(world.timeScale !== 1));
        slow.textContent = world.timeScale === 1 ? '慢动作' : '0.25 ×';
        document.body.dataset['timeScale'] = String(world.timeScale);
    });
    const home = new Hilo3d.Vector3(...options.camera);
    const target = new Hilo3d.Vector3(...options.target);
    const resizeCamera = (): void => {
        const mobile = window.innerWidth <= 700;
        const factor =
            Math.max(1, 0.95 / camera.aspect) *
            (mobile ? (options.mobileDistanceScale ?? 1.16) : 1);
        const framingTarget = mobile ? new Hilo3d.Vector3(0, target.y, target.z) : target;
        const position = home.clone().subtract(target).scale(factor).add(framingTarget);
        orbitControls.setView(position, framingTarget);
        document
            .querySelector<HTMLElement>('.chapter-link[aria-current="page"]')
            ?.scrollIntoView({ block: 'nearest', inline: 'center' });
    };
    requireElement('#camera-home').addEventListener('click', resizeCamera);
    window.addEventListener('resize', resizeCamera);
    resizeCamera();
    let diagnosticTime = 0;
    ticker.addTick({
        tick(deltaTime: number): void {
            diagnosticTime += deltaTime;
            if (diagnosticTime < 150) return;
            diagnosticTime = 0;
            const diagnostics = world.getDiagnostics();
            document.body.dataset['physicsSteps'] = String(diagnostics.simulatedSteps);
            requireElement('#live-state').textContent = world.paused
                ? 'SIMULATION PAUSED'
                : 'LIVE SIMULATION';
            requireElement('#engine-info').textContent =
                `${stage.renderer.backend.toUpperCase()} / ${String(Math.round(1 / world.fixedTimeStep))} HZ`;
        }
    });
    window.addEventListener('pagehide', (event: PageTransitionEvent) => {
        if (event.persisted) {
            ticker.stop();
            return;
        }
        window.removeEventListener('resize', resizeCamera);
        context.dispose();
    });
    window.addEventListener('pageshow', (event: PageTransitionEvent) => {
        if (event.persisted) ticker.start();
    });

    const runtime: ExhibitRuntime = {
        stage,
        camera,
        ticker,
        orbitControls,
        action,
        material(color, roughness = 0.32, metallic = 0.12): Hilo3d.PBRMaterial {
            const key = [color, roughness, metallic].join('/');
            let material = materials.get(key);
            if (!material) {
                material = new Hilo3d.PBRMaterial({
                    baseColor: new Hilo3d.Color(
                        ...([(color >> 16) & 255, (color >> 8) & 255, color & 255].map(value => {
                            const srgb = value / 255;
                            return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
                        }) as [number, number, number])
                    ),
                    roughness,
                    metallic,
                    brdfLUT,
                    diffuseEnvMap: { texture: maps.diffuseEnvMap, encoding: 'srgb' },
                    specularEnvMap: { texture: maps.specularEnvMap, encoding: 'srgb' }
                });
                materials.set(key, material);
            }
            return material;
        },
        box(parent, x, y, z, width, height, depth, material): Hilo3d.Mesh {
            const key = [width, height, depth].join('/');
            let geometry = geometries.get(key);
            if (!geometry) {
                geometry = roundedBox(width, height, depth);
                geometries.set(key, geometry);
            }
            return new Hilo3d.Mesh({
                x,
                y,
                z,
                geometry,
                material,
                castShadows: true,
                receiveShadows: true
            }).addTo(parent);
        },
        sphere(parent, x, y, z, radius, material): Hilo3d.Mesh {
            return new Hilo3d.Mesh({
                x,
                y,
                z,
                scaleX: radius,
                scaleY: radius,
                scaleZ: radius,
                geometry: sphere,
                material,
                castShadows: true,
                receiveShadows: true
            }).addTo(parent);
        },
        cylinder(parent, x, y, z, radius, height, material): Hilo3d.Mesh {
            return new Hilo3d.Mesh({
                x,
                y,
                z,
                scaleX: radius,
                scaleY: height,
                scaleZ: radius,
                geometry: cylinder,
                material,
                castShadows: true,
                receiveShadows: true
            }).addTo(parent);
        },
        label(parent, text, x, y, z, width, color = '#dae5db'): Hilo3d.Mesh {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Exhibit lettering requires Canvas 2D');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = '500 52px "Avenir Next", "Helvetica Neue", sans-serif';
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 512, 64, 990);
            const texture = new Hilo3d.Texture({ image: canvas, flipY: true });
            return new Hilo3d.Mesh({
                x,
                y,
                z,
                castShadows: false,
                receiveShadows: false,
                geometry: new Hilo3d.PlaneGeometry({ width, height: width / 8 }),
                material: new Hilo3d.BasicMaterial({
                    lightType: 'NONE',
                    diffuse: texture,
                    compositing: { mode: 'alpha-blend', premultiplied: false },
                    state: { depthWrite: false },
                    cullMode: 'none'
                })
            }).addTo(parent);
        },
        setMetric(key, label, value): void {
            let output = metricElements.get(key);
            if (!output) {
                const item = document.createElement('div');
                const heading = document.createElement('span');
                heading.textContent = label;
                output = document.createElement('strong');
                output.dataset['metric'] = key;
                item.append(heading, output);
                requireElement('#metrics').appendChild(item);
                metricElements.set(key, output);
            }
            output.textContent = value;
        },
        setStatus(text): void {
            requireElement('#scene-status').textContent = text;
        },
        start(): void {
            document.body.dataset['exampleReady'] = 'true';
            document.body.dataset['paused'] = 'false';
            document.body.dataset['timeScale'] = '1';
            requireElement('#loading').remove();
            ticker.start();
        }
    };
    // Curved studio sweep: continuous floor/backdrop, so front-facing exhibits have no horizon seam.
    const floorY = options.floorY ?? -1.06;
    const sweepPositions: number[] = [];
    const sweepNormals: number[] = [];
    const sweepIndices: number[] = [];
    const profile: { z: number; y: number; ny: number; nz: number }[] = [
        { z: 100, y: floorY, ny: 1, nz: 0 }
    ];
    for (let index = 0; index <= 32; index++) {
        const angle = ((index / 32) * Math.PI) / 2;
        profile.push({
            z: -12 - 18 * Math.sin(angle),
            y: floorY + 18 * (1 - Math.cos(angle)),
            ny: Math.cos(angle),
            nz: Math.sin(angle)
        });
    }
    profile.push({ z: -30, y: 100, ny: 0, nz: 1 });
    for (const point of profile) {
        for (const x of [-100, 100]) {
            sweepPositions.push(x, point.y, point.z);
            sweepNormals.push(0, point.ny, point.nz);
        }
    }
    for (let index = 0; index < profile.length - 1; index++) {
        const a = index * 2;
        sweepIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    new Hilo3d.Mesh({
        geometry: new Hilo3d.Geometry({
            vertices: new Hilo3d.GeometryData(new Float32Array(sweepPositions), 3),
            normals: new Hilo3d.GeometryData(new Float32Array(sweepNormals), 3),
            indices: new Hilo3d.GeometryData(new Uint16Array(sweepIndices), 1)
        }),
        material: runtime.material(0x183235, 0.95, 0),
        castShadows: false,
        receiveShadows: true
    }).addTo(stage);
    return runtime;
}
