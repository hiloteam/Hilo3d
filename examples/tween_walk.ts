import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage } = await createExampleContext();

camera.far = 5;
const container = new Hilo3d.Node({
    rotationX: -60,
    rotationY: 30
}).addTo(stage);
const loader = new Hilo3d.GLTFLoader();
void loader
    .load({
        src: './models/Tmall/Tmall.gltf'
    })
    .then(function (model) {
        const box = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.PBRMaterial({
                baseColor: new Hilo3d.Color(0.6, 0.9, 0.3)
            })
        });

        model.node.setScale(0.003);
        model.node.y = 0.5;
        model.node.z = -0.5;

        const run = function () {
            const node = model.node;
            const Tween = Hilo3d.Tween;
            const moveTime = 2000;
            const rotateTime = 500;
            Tween.to(node, { z: 0.5 }, { duration: moveTime })
                .link(Tween.to(node, { rotationX: 90 }, { duration: rotateTime, delay: '+0' }))
                .link(Tween.to(node, { y: -0.5 }, { duration: moveTime, delay: '+0' }))
                .link(Tween.to(node, { rotationX: 180 }, { duration: rotateTime, delay: '+0' }))
                .link(Tween.to(node, { z: -0.5 }, { duration: moveTime, delay: '+0' }))
                .link(Tween.to(node, { rotationX: 270 }, { duration: rotateTime, delay: '+0' }))
                .link(Tween.to(node, { y: 0.5 }, { duration: moveTime, delay: '+0' }))
                .link(
                    Tween.to(
                        node,
                        { rotationX: 360 },
                        {
                            duration: rotateTime,
                            delay: '+0',
                            onComplete() {
                                node.rotationX = 0;
                                run();
                            }
                        }
                    )
                );
        };

        run();
        container.addChild(box);
        container.addChild(model.node);
    })
    .catch((error: unknown) => {
        console.error('Failed to load tween walk model', error);
    });

new Hilo3d.DirectionalLight({
    color: new Hilo3d.Color(1, 1, 1),
    amount: 2,
    direction: new Hilo3d.Vector3(0, 1, -1),
    shadow: {}
}).addTo(container);

new Hilo3d.AmbientLight({
    color: new Hilo3d.Color(1, 1, 1),
    amount: 0.1
}).addTo(stage);
