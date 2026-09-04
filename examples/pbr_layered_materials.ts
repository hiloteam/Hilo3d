import {
    Color,
    LocalTransform,
    MeshRenderer,
    PBRMaterial,
    PlaneGeometry,
    PointLight,
    SphereGeometry
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

type FeatureName = 'anisotropy' | 'clearcoat' | 'transmission';
const runtime = await createExampleRuntime();
runtime.engine.renderer.clearColor.set(0.003, 0.006, 0.018, 1);
runtime.controls.setView({ x: 0.5, y: 0.2, z: 0 }, 8.4, 0.78, 1.15);
const sphere = new SphereGeometry({ radius: 1, heightSegments: 40, widthSegments: 64 });
const featureParameters = {
    anisotropy: {
        baseColor: new Color(0.42, 0.12, 0.04),
        metallic: 1,
        roughness: 0.34,
        anisotropyStrength: 0.88,
        anisotropyRotation: Math.PI * 0.18
    },
    clearcoat: {
        baseColor: new Color(0.035, 0.17, 0.72),
        metallic: 0.08,
        roughness: 0.48,
        clearcoatFactor: 1,
        clearcoatRoughnessFactor: 0.08
    },
    transmission: {
        baseColor: new Color(0.48, 0.94, 1),
        metallic: 0,
        roughness: 0.08,
        transmissionFactor: 0.94,
        thicknessFactor: 1.15,
        attenuationDistance: 1.45,
        attenuationColor: new Color(0.12, 0.78, 1),
        ior: 1.46
    }
} as const;
const entries = (['anisotropy', 'clearcoat', 'transmission'] as const).map((feature, index) => ({
    feature,
    entity: createMeshEntity(runtime.world, {
        geometry: sphere,
        material: new PBRMaterial(featureParameters[feature]),
        position: [(index - 1) * 2.5, 0.3, 0]
    })
}));
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry(),
    material: new PBRMaterial({
        baseColor: new Color(0.018, 0.024, 0.046),
        metallic: 0.72,
        roughness: 0.42
    }),
    position: [0, -1.1, 0],
    scale: [9, 9, 9]
});
for (const position of [
    [-4, 4, 3],
    [4, 2, 2]
] as const) {
    const light = runtime.world.createEntity(LocalTransform, { position });
    runtime.world.add(light, PointLight, {
        amount: 20,
        range: 18,
        color: position[0] < 0 ? [1, 0.55, 0.3] : [0.2, 0.75, 1]
    });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-feature]')) {
    button.addEventListener('click', () => {
        const feature = button.dataset['feature'] as FeatureName | undefined;
        const entry = entries.find(value => value.feature === feature);
        if (!entry || !feature) return;
        const enabled = button.getAttribute('aria-pressed') !== 'true';
        const base = featureParameters[feature];
        const material = new PBRMaterial({
            ...base,
            ...(feature === 'anisotropy' ? { anisotropyStrength: enabled ? 0.88 : 0 } : {}),
            ...(feature === 'clearcoat' ? { clearcoatFactor: enabled ? 1 : 0 } : {}),
            ...(feature === 'transmission' ? { transmissionFactor: enabled ? 0.94 : 0 } : {})
        });
        runtime.world.set(entry.entity, MeshRenderer, { geometry: sphere, material });
        button.setAttribute('aria-pressed', String(enabled));
        button.textContent = `${feature} · ${enabled ? 'on' : 'off'}`;
    });
}
runtime.start();
