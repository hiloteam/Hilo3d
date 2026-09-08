import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import environmentIrradiance from './image/environment/photo-studio-loft-hall/spherical-harmonics.json';

const { stage, ambientLight } = await createExampleContext();

initModel();
initLight();

function initModel() {
    const sh3 = new Hilo3d.SphericalHarmonics3().fromArray(environmentIrradiance).scaleForRender();
    const node = new Hilo3d.Node();
    node.setScale(0.2);
    stage.addChild(node);

    const geometry = new Hilo3d.SphereGeometry({
        radius: 0.45,
        heightSegments: 16,
        widthSegments: 32
    });

    const colors = [
        [0.56, 0.57, 0.58], //铁
        [0.95, 0.64, 0.54], //铜
        [1, 0.71, 0.29], //金
        [0.95, 0.93, 0.88] //银
    ];

    const num = 8;
    for (let i = 0; i < num; i++) {
        for (let j = 0; j < num; j++) {
            const x = i - num * 0.5;
            const y = j - num * 0.5;
            const metallic = i / num;
            const roughness = j / num;
            const colorCount = colors.length;
            colors.forEach((color, index) => {
                const [red = 0, green = 0, blue = 0] = color;
                const material = new Hilo3d.PBRMaterial({
                    baseColor: new Hilo3d.Color(red, green, blue),
                    metallic,
                    roughness,
                    diffuseEnvSphereHarmonics3: sh3
                });

                const mesh = new Hilo3d.Mesh({
                    geometry,
                    material,
                    x,
                    y,
                    z: (index - colorCount * 0.5) * 2
                });

                node.addChild(mesh);
            });
        }
    }
}

function initLight() {
    ambientLight.amount = 0.03;

    const pointLight = new Hilo3d.PointLight({
        color: new Hilo3d.Color(0.3, 0.3, 0.3),
        x: 5,
        y: 0,
        z: 5,
        range: 500
    });
    stage.addChild(pointLight);

    Hilo3d.Tween.to(
        pointLight,
        {
            x: -5
        },
        {
            duration: 2000,
            loop: true,
            reverse: true
        }
    );
}
