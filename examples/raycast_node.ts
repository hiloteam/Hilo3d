import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage } = createExampleContext();

function rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

const geometry = new Hilo3d.PlaneGeometry();

for (let i = 0; i < 100; i++) {
    const rect = new Hilo3d.Mesh({
        geometry,
        material: new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            diffuse: new Hilo3d.Color(Math.random(), Math.random(), Math.random())
        }),
        x: rand(-0.5, 0.5),
        y: rand(-0.5, 0.5),
        z: rand(-1, 1)
    });
    rect.setScale(rand(0.2, 0.2));
    stage.addChild(rect);
}

const ray = new Hilo3d.Ray();
document.body.onclick = function (e) {
    const mousePos = {
        x: e.clientX,
        y: e.clientY
    };

    ray.fromCamera(camera, mousePos.x, mousePos.y, stage.width, stage.height);

    const hitResult = stage.raycast(ray, true);
    const nodeHits =
        hitResult?.filter(
            (hit): hit is Hilo3d.NodeRaycastInfo => !(hit instanceof Hilo3d.Vector3)
        ) ?? [];
    if (nodeHits.length > 0) {
        console.log(nodeHits);
        nodeHits.forEach((raycastInfo, index) => {
            const mesh = raycastInfo.mesh;
            Hilo3d.Tween.to(
                mesh,
                {
                    scaleX: 0,
                    scaleY: 0
                },
                {
                    reverse: false,
                    duration: 300,
                    delay: index * 250,
                    onComplete() {
                        mesh.removeFromParent();
                    }
                }
            );
        });
    }
};
