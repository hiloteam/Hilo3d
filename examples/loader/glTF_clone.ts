import * as Hilo3d from '../../src/Hilo3d';
import { createExampleContext } from '../js/init';

const { stage, renderer } = createExampleContext();

renderer.useInstanced = true;
const loader = new Hilo3d.GLTFLoader();
void loader
    .load({
        src: '../models/Tmall/Tmall.gltf'
    })
    .then(function (model) {
        const node = model.node;
        node.setScale(0.002);
        stage.addChild(node);
        for (let i = 0; i < 100; i++) {
            const cloneNode = node.clone();
            if (!cloneNode.anim) continue;
            cloneNode.anim.timeScale = Math.random();
            cloneNode.setScale(0.0005);
            cloneNode.x = Math.random() * 2 - 1;
            cloneNode.y = Math.random() * 2 - 1;
            cloneNode.z = Math.random() * 2 - 1;
            cloneNode.anim.stop();
            stage.addChild(cloneNode);
        }
    })
    .catch((error: unknown) => {
        console.error('Failed to load clone source model', error);
    });

stage.addChild(new Hilo3d.AxisNetHelper({ size: 4 }));
