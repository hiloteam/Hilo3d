import * as Hilo3d from '../../src/Hilo3d';
import type { EnvironmentMaps } from './init';

export function environmentMaterialDefaults(
    maps: EnvironmentMaps
): Readonly<Pick<Hilo3d.PBRMaterialParameters, 'brdfLUT' | 'diffuseEnvMap' | 'specularEnvMap'>> {
    return Object.freeze({
        brdfLUT: maps.brdfLUT,
        diffuseEnvMap: Object.freeze({ texture: maps.diffuseEnvMap, encoding: 'srgb' as const }),
        specularEnvMap: Object.freeze({ texture: maps.specularEnvMap, encoding: 'srgb' as const })
    });
}

export function addEnvironmentSkybox(
    stage: Hilo3d.Stage,
    texture: Hilo3d.MaterialTexture,
    scale = 40
): Hilo3d.Mesh {
    const skybox = new Hilo3d.Mesh({
        geometry: new Hilo3d.BoxGeometry(),
        material: new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            cullMode: 'front',
            state: { depthWrite: false },
            diffuse: texture
        }),
        castShadows: false,
        receiveShadows: false,
        renderOrder: -1000
    }).addTo(stage);
    skybox.setScale(scale);
    return skybox;
}
