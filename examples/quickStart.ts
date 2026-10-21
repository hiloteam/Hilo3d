import * as Hilo3d from '../src/Hilo3d';
import { addEnvironmentSkybox, environmentMaterialDefaults } from './shared/environment';
import { loadEnvironmentMaps, resolveExampleBackend } from './shared/init';
import { createExampleLights, createExampleRenderPipeline } from './shared/lighting';
import {
    createExampleStage,
    ExampleInitializationCancelledError
} from './shared/createExampleStage';

const cameraTarget = new Hilo3d.Vector3(0, 0.35, 0);
const camera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    far: 40,
    near: 0.1,
    x: 0,
    y: 1.65,
    z: 5
});
const container = document.querySelector<HTMLElement>('#container');
if (!container) throw new Error('Quick start example requires #container');

const runtime = await createExampleStage({
    backend: resolveExampleBackend(),
    container,
    camera,
    width: innerWidth,
    height: innerHeight,
    antialias: true,
    renderPipeline: createExampleRenderPipeline(),
    clearColor: new Hilo3d.Color(0.008, 0.012, 0.028)
}).catch((error: unknown) => {
    if (error instanceof ExampleInitializationCancelledError) return null;
    throw error;
});
if (runtime !== null) {
    const { stage, ticker, lifecycle } = runtime;
    try {
        const orbitControls = new Hilo3d.OrbitControls(stage, {
            target: cameraTarget,
            enablePan: false,
            minDistance: 2,
            maxDistance: 12
        });

        lifecycle.onDispose(() => {
            orbitControls.dispose();
        });

        const handleResize = (): void => {
            camera.aspect = innerWidth / innerHeight;
            stage.resize(innerWidth, innerHeight);
        };
        window.addEventListener('resize', handleResize);
        lifecycle.onDispose(() => {
            window.removeEventListener('resize', handleResize);
        });

        const environment = await loadEnvironmentMaps();
        lifecycle.onDispose(() => {
            environment.brdfLUT.destroy();
            environment.diffuseEnvMap.destroy();
            environment.specularEnvMap.destroy();
            environment.skyboxMap.destroy();
        });
        if (!lifecycle.disposed) {
            addEnvironmentSkybox(stage, environment.skyboxMap);

            const floorMaterial = new Hilo3d.PBRMaterial({
                ...environmentMaterialDefaults(environment),
                baseColor: new Hilo3d.Color(0.3, 0.31, 0.33),
                baseColorMap: new Hilo3d.LazyTexture({
                    src: new URL('./image/hilo-showroom-grid-v2.jpg', import.meta.url).href
                }),
                metallic: 0.15,
                roughness: 0.72
            });
            new Hilo3d.Mesh({
                y: -1,
                rotationX: -90,
                geometry: new Hilo3d.PlaneGeometry(),
                material: floorMaterial,
                castShadows: false
            })
                .setScale(8)
                .addTo(stage);

            const hero = new Hilo3d.Node({ y: 0.05 }).addTo(stage);
            const coreMaterial = new Hilo3d.PBRMaterial({
                ...environmentMaterialDefaults(environment),
                baseColor: new Hilo3d.Color(0.12, 0.55, 0.44),
                metallic: 0.74,
                roughness: 0.28
            });
            const core = new Hilo3d.Mesh({
                geometry: new Hilo3d.BoxGeometry({ width: 1.25, height: 1.25, depth: 1.25 }),
                material: coreMaterial,
                rotationX: 24,
                rotationY: 35
            }).addTo(hero);

            const satelliteGeometry = new Hilo3d.SphereGeometry({
                radius: 0.14,
                heightSegments: 16,
                widthSegments: 24
            });
            const satelliteMaterials = [
                new Hilo3d.Color(0.5, 0.42, 1),
                new Hilo3d.Color(0.25, 0.78, 1)
            ].map(
                baseColor =>
                    new Hilo3d.PBRMaterial({
                        ...environmentMaterialDefaults(environment),
                        baseColor,
                        metallic: 0.42,
                        roughness: 0.25
                    })
            );
            for (let index = 0; index < 10; index += 1) {
                const angle = (index / 10) * Math.PI * 2;
                const material = satelliteMaterials[index % satelliteMaterials.length];
                if (!material) throw new Error('Missing satellite material.');
                new Hilo3d.Mesh({
                    x: Math.cos(angle) * 1.55,
                    y: Math.sin(angle * 2) * 0.28,
                    z: Math.sin(angle) * 1.55,
                    geometry: satelliteGeometry,
                    material
                }).addTo(hero);
            }
            hero.onUpdate = deltaTime => {
                hero.rotationY += deltaTime * 0.018;
                core.rotationX += deltaTime * 0.013;
                core.rotationZ += deltaTime * 0.009;
            };

            const { directionLight, ambientLight } = createExampleLights();
            directionLight.shadow = {
                width: 2048,
                height: 2048,
                cameraInfo: {
                    left: -7,
                    right: 7,
                    bottom: -7,
                    top: 7,
                    near: 0.1,
                    far: 30,
                    x: 6.5,
                    y: 9,
                    z: 3
                }
            };
            stage.addChild(ambientLight).addChild(directionLight);

            ticker.start();
        }
    } catch (error) {
        try {
            lifecycle.dispose();
        } catch (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                'Quick start initialization and cleanup failed',
                { cause: cleanupError }
            );
        }
        throw error;
    }
}
