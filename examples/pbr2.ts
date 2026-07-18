import * as Hilo3d from '../src/Hilo3d';
import { addEnvironmentSkybox } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

const { stage, ambientLight } = await createExampleContext();

async function initializeMaterials(): Promise<void> {
    const environment = await loadEnvironmentMaps();
    const node = new Hilo3d.Node().setScale(0.2).addTo(stage);
    const geometry = new Hilo3d.SphereGeometry({
        radius: 0.45,
        heightSegments: 16,
        widthSegments: 32
    });
    const colors = [
        [0.56, 0.57, 0.58],
        [0.95, 0.64, 0.54],
        [1, 0.71, 0.29],
        [0.95, 0.93, 0.88]
    ];
    const gridSize = 8;

    for (let column = 0; column < gridSize; column += 1) {
        for (let row = 0; row < gridSize; row += 1) {
            colors.forEach((color, colorIndex) => {
                const [red = 0, green = 0, blue = 0] = color;
                const material = new Hilo3d.PBRMaterial({
                    baseColor: new Hilo3d.Color(red, green, blue),
                    metallic: column / gridSize,
                    roughness: row / gridSize,
                    brdfLUT: environment.brdfLUT,
                    diffuseEnvMap: environment.diffuseEnvMap,
                    specularEnvMap: environment.specularEnvMap
                });
                node.addChild(
                    new Hilo3d.Mesh({
                        geometry,
                        material,
                        x: column - gridSize * 0.5,
                        y: row - gridSize * 0.5,
                        z: (colorIndex - colors.length * 0.5) * 2
                    })
                );
            });
        }
    }
    addEnvironmentSkybox(stage, environment.specularEnvMap);
}

function initializeLight(): void {
    ambientLight.amount = 0.03;
    const pointLight = new Hilo3d.PointLight({
        color: new Hilo3d.Color(0.3, 0.3, 0.3),
        x: 5,
        z: 5,
        range: 500
    }).addTo(stage);
    Hilo3d.Tween.to(
        pointLight,
        { x: -5 },
        {
            duration: 2000,
            loop: true,
            reverse: true
        }
    );
}

initializeLight();
void initializeMaterials().catch((error: unknown) => {
    console.error('Failed to initialize PBR material grid', error);
});
