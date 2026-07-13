import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

const { stage } = createExampleContext();

async function initialize(): Promise<void> {
    const environment = await loadEnvironmentMaps();
    const node = new Hilo3d.Node().setScale(0.3).addTo(stage);
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
    const gridSize = 3;

    for (let column = 0; column < gridSize; column += 1) {
        for (let row = 0; row < gridSize; row += 1) {
            colors.forEach((color, colorIndex) => {
                const [red = 0, green = 0, blue = 0] = color;
                node.addChild(
                    new Hilo3d.Mesh({
                        geometry,
                        material: new Hilo3d.PBRMaterial({
                            baseColor: new Hilo3d.Color(red, green, blue),
                            metallic: column / gridSize,
                            roughness: row / gridSize,
                            brdfLUT: environment.brdfLUT,
                            diffuseEnvMap: environment.diffuseEnvMap,
                            specularEnvMap: environment.specularEnvMap
                        }),
                        x: column - gridSize * 0.5,
                        y: row - gridSize * 0.5,
                        z: colorIndex - colors.length * 0.5
                    })
                );
            });
        }
    }

    const reflectiveMaterial = new Hilo3d.BasicMaterial({
        specularEnvMap: environment.specularEnvMap,
        diffuse: new Hilo3d.Color(1, 1, 1),
        specular: new Hilo3d.Color(1, 1, 1),
        refractRatio: 1 / 1.5,
        reflectivity: 0.8,
        useHDR: true
    });
    const box = new Hilo3d.Mesh({
        material: reflectiveMaterial,
        geometry: new Hilo3d.BoxGeometry(),
        x: -0.6,
        y: -0.15,
        z: -0.2,
        rotationY: 90
    }).addTo(stage);
    box.setScale(1.5, 1.5, 0.05);
    box.onUpdate = () => {
        reflectiveMaterial.specularEnvMatrix ??= new Hilo3d.Matrix4();
        reflectiveMaterial.specularEnvMatrix.copy(stage.worldMatrix).invert();
    };
}

void initialize().catch((error: unknown) => {
    console.error('Failed to initialize sphere environment-map example', error);
});
