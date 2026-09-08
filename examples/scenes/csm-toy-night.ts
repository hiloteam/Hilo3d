import * as Hilo3d from '../../src/Hilo3d';
import { environmentMaterialDefaults } from '../shared/environment';
import type { EnvironmentMaps } from '../shared/init';

type Point3 = readonly [number, number, number];
type ProfilePoint = readonly [number, number];
interface LightFade {
    readonly light: Hilo3d.SpotLight;
    readonly targetAmount: number;
    readonly startDelay: number;
    readonly lensMaterial: Hilo3d.PBRMaterial | null;
}

const LIGHT_FADE_DURATION = 350;
const LIGHT_SEQUENCE_DURATION = 1250 + LIGHT_FADE_DURATION;

/** Rounded, turned toy parts share one radial mesh instead of faceted cylinders. */
function turnedPart(profile: readonly ProfilePoint[]): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const segments = 32;
    for (const [ring, point] of profile.entries()) {
        const previous = profile[Math.max(0, ring - 1)] ?? point;
        const next = profile[Math.min(profile.length - 1, ring + 1)] ?? point;
        const radial = next[1] - previous[1];
        const vertical = previous[0] - next[0];
        const length = Math.hypot(radial, vertical) || 1;
        for (let segment = 0; segment <= segments; segment += 1) {
            const angle = (segment / segments) * Math.PI * 2;
            positions.push(Math.cos(angle) * point[0], point[1], Math.sin(angle) * point[0]);
            normals.push(
                (Math.cos(angle) * radial) / length,
                vertical / length,
                (Math.sin(angle) * radial) / length
            );
            uvs.push(segment / segments, ring / (profile.length - 1));
            if (ring > 0 && segment < segments) {
                const a = (ring - 1) * (segments + 1) + segment;
                const b = a + 1;
                const d = a + segments + 1;
                indices.push(a, d, d + 1, a, d + 1, b);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        uvs: new Hilo3d.GeometryData(new Float32Array(uvs), 2),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

/** Shared-renderer light fixtures for the toy town's dusk scene. */
export interface CsmToyNight {
    readonly transitionComplete: boolean;
    setEnabled(enabled: boolean): void;
    setShadowEnabled(enabled: boolean): void;
    tick(dt: number, motion: boolean): void;
}

/** All illumination uses public SpotLights; the warm lenses are the only emissive geometry. */
export function createCsmToyNight(
    parent: Hilo3d.Node,
    maps: EnvironmentMaps,
    engine: Hilo3d.Node
): CsmToyNight {
    const material = (color: Point3, metallic = 0): Hilo3d.PBRMaterial =>
        new Hilo3d.PBRMaterial({
            ...environmentMaterialDefaults(maps),
            baseColor: new Hilo3d.Color(...color),
            roughness: 0.3,
            metallic,
            clearcoatFactor: 0.28,
            clearcoatRoughnessFactor: 0.2,
            diffuseEnvIntensity: 0.5,
            specularEnvIntensity: 0.4
        });
    const mint = material([0.14, 0.37, 0.33]);
    const brass = material([0.67, 0.43, 0.17], 0.5);
    const sphere = new Hilo3d.SphereGeometry({ radius: 1, widthSegments: 32, heightSegments: 20 });
    const pole = turnedPart([
        [0, 0],
        [0.43, 0],
        [0.49, 0.06],
        [0.49, 0.16],
        [0.4, 0.24],
        [0.26, 0.3],
        [0.2, 0.42],
        [0.145, 4.85],
        [0.2, 4.96],
        [0.2, 5.06],
        [0, 5.1]
    ]);
    const collar = turnedPart([
        [0, -0.1],
        [0.26, -0.1],
        [0.31, -0.045],
        [0.31, 0.045],
        [0.26, 0.1],
        [0, 0.1]
    ]);
    const shade = turnedPart([
        [0, -0.09],
        [0.66, -0.09],
        [0.74, -0.05],
        [0.77, 0.04],
        [0.7, 0.12],
        [0.54, 0.17],
        [0.4, 0.37],
        [0.22, 0.48],
        [0, 0.51]
    ]);
    const mesh = (
        name: string,
        geometry: Hilo3d.Geometry,
        selected: Hilo3d.PBRMaterial,
        position: Point3,
        scale: Point3,
        owner: Hilo3d.Node,
        castShadows = true
    ): Hilo3d.Mesh =>
        new Hilo3d.Mesh({
            name,
            geometry,
            material: selected,
            x: position[0],
            y: position[1],
            z: position[2],
            scaleX: scale[0],
            scaleY: scale[1],
            scaleZ: scale[2],
            useInstanced: true,
            castShadows,
            receiveShadows: true,
            pointerEnabled: false
        }).addTo(owner);
    const shadowConfigurations = new Map<Hilo3d.SpotLight, Hilo3d.LightShadowOptions>();
    const lightFades: LightFade[] = [];
    const spotlight = (
        name: string,
        position: Point3,
        direction: Point3,
        amount: number,
        range: number,
        cutoff: number,
        outerCutoff: number,
        startDelay: number,
        lensMaterial: Hilo3d.PBRMaterial | null,
        owner = parent,
        shadowNear = 0.1
    ): Hilo3d.SpotLight => {
        const shadowConfiguration: Hilo3d.LightShadowOptions = {
            width: 512,
            height: 512,
            minBias: 0.00012,
            maxBias: 0.0016,
            cameraInfo: { near: shadowNear, far: range, fov: outerCutoff * 2, aspect: 1 }
        };
        const light = new Hilo3d.SpotLight({
            name,
            x: position[0],
            y: position[1],
            z: position[2],
            color: new Hilo3d.Color(1, 0.61, 0.25),
            direction: new Hilo3d.Vector3(...direction).normalize(),
            amount: 0,
            range,
            cutoff,
            outerCutoff,
            enabled: false,
            shadow: shadowConfiguration
        }).addTo(owner);
        lightFades.push({ light, targetAmount: amount, startDelay, lensMaterial });
        shadowConfigurations.set(light, shadowConfiguration);
        return light;
    };

    const lampPlan = [
        { name: 'Station', position: [-3, 0.84, 16], height: 5.9, startDelay: 250 },
        { name: 'Bridge', position: [10, 0.84, -5], height: 6.4, startDelay: 500 },
        { name: 'Harbor', position: [9, 0.84, -30], height: 6.1, startDelay: 750 }
    ] as const;
    for (const lamp of lampPlan) {
        const owner = new Hilo3d.Node({
            name: `ToyStreetlamp${lamp.name}`,
            x: lamp.position[0],
            y: lamp.position[1],
            z: lamp.position[2]
        }).addTo(parent);
        const stemHeight = lamp.height - 0.76;
        const glass = material([0.94, 0.73, 0.37]);
        mesh('ToyStreetlampPole', pole, mint, [0, 0, 0], [1, stemHeight / 5.1, 1], owner);
        mesh('ToyStreetlampFootRing', collar, brass, [0, 0.45, 0], [1, 1, 1], owner);
        mesh('ToyStreetlampCollar', collar, brass, [0, stemHeight - 0.04, 0], [1, 1, 1], owner);
        mesh(
            'ToyStreetlampLens',
            sphere,
            glass,
            [0, stemHeight + 0.36, 0],
            [0.41, 0.48, 0.41],
            owner,
            false
        );
        mesh('ToyStreetlampShade', shade, mint, [0, lamp.height, 0], [1, 1, 1], owner);
        mesh(
            'ToyStreetlampFinial',
            sphere,
            brass,
            [0, lamp.height + 0.51, 0],
            [0.12, 0.17, 0.12],
            owner
        );
        const streetlight = spotlight(
            `ToyStreetlight${lamp.name}`,
            // The upright globe has no side-facing optic: its pool is centred vertically below it.
            [0, stemHeight + 0.36, 0],
            [0, -1, 0],
            85,
            12,
            18,
            30,
            lamp.startDelay,
            glass,
            owner,
            // A point approximation must not turn the globe's immediate support into a huge
            // dark cone. Start below the near fixture; bridge/rail/tree casters remain in range.
            1.2
        );
        streetlight.color.set(1, 0.48, 0.16, 1);
    }

    // The locomotive's local +Z is its rail tangent; parenting also rotates the shadow camera.
    const headlightGlass = material([0.94, 0.73, 0.37]);
    mesh(
        'ToyTrainHeadlightLens',
        sphere,
        headlightGlass,
        [0, 1.75, 1.77],
        [0.28, 0.28, 0.16],
        engine,
        false
    );
    spotlight(
        'ToyTrainHeadlight',
        [0, 1.75, 1.96],
        [0, -0.18, 1],
        55,
        22,
        18,
        28,
        1000,
        headlightGlass,
        engine
    );

    const lighthouse = spotlight(
        'ToyLighthouseBeacon',
        [12, 14, -42],
        [-0.36, -0.4, 1],
        600,
        75,
        13,
        21,
        1250,
        null
    );
    let enabled = false;
    let transitionStartedAt = 0;
    let transitionComplete = true;
    let beaconPhase = -0.35;
    return {
        get transitionComplete(): boolean {
            return transitionComplete;
        },
        setEnabled(value: boolean): void {
            if (value === enabled) return;
            enabled = value;
            transitionStartedAt = performance.now();
            transitionComplete = !value;
            // Keep one light-count/shadow-layout variant throughout the entire dusk sequence.
            for (const fade of lightFades) {
                fade.light.enabled = value;
                fade.light.amount = 0;
                fade.light.isDirty = true;
                fade.lensMaterial?.emissionFactor.set(0, 0, 0, 1);
            }
        },
        setShadowEnabled(value: boolean): void {
            for (const { light } of lightFades)
                light.shadow = value ? (shadowConfigurations.get(light) ?? null) : null;
        },
        tick(dt: number, motion: boolean): void {
            if (!enabled) return;
            if (!transitionComplete) {
                // A paused train or a slow frame must not stretch the switch-on sequence.
                const elapsed = performance.now() - transitionStartedAt;
                for (const fade of lightFades) {
                    const progress = Math.min(
                        1,
                        Math.max(0, (elapsed - fade.startDelay) / LIGHT_FADE_DURATION)
                    );
                    const intensity = progress * progress * (3 - 2 * progress);
                    fade.light.amount = fade.targetAmount * intensity;
                    fade.light.isDirty = true;
                    fade.lensMaterial?.emissionFactor.set(
                        3.8 * intensity,
                        1.7 * intensity,
                        0.42 * intensity,
                        1
                    );
                }
                transitionComplete = elapsed >= LIGHT_SEQUENCE_DURATION;
            }
            if (!motion) return;
            beaconPhase += (Math.min(dt, 50) / 1000) * 0.16;
            lighthouse.direction.set(Math.sin(beaconPhase), -0.4, Math.cos(beaconPhase));
            lighthouse.isDirty = true;
        }
    };
}
