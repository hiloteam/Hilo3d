import * as Hilo3d from '../../src/Hilo3d';
import type { EnvironmentMaps } from './init';

export function applyEnvironmentMaps(
    materials: readonly Hilo3d.Material[],
    maps: EnvironmentMaps
): void {
    for (const material of materials) {
        if (!(material instanceof Hilo3d.PBRMaterial)) continue;
        material.brdfLUT = maps.brdfLUT;
        material.diffuseEnvMap = maps.diffuseEnvMap;
        material.specularEnvMap = maps.specularEnvMap;
        material.isDirty = true;
    }
}

export function addEnvironmentSkybox(
    stage: Hilo3d.Stage<Hilo3d.RendererBackend>,
    texture: Hilo3d.MaterialTexture,
    scale = 20
): Hilo3d.Mesh {
    const skybox = new Hilo3d.Mesh({
        geometry: new Hilo3d.BoxGeometry(),
        material: new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            side: Hilo3d.constants.BACK,
            diffuse: texture
        })
    }).addTo(stage);
    skybox.setScale(scale);
    return skybox;
}
