import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext();

function rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

const geometry = new Hilo3d.PlaneGeometry();
const container = new Hilo3d.Node();
stage.addChild(container);

for (let i = 0; i < 100; i++) {
    const rect = new Hilo3d.Mesh({
        geometry,
        material: new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            diffuse: new Hilo3d.Color(Math.random(), Math.random(), Math.random()),
            compositing: { mode: 'alpha-blend', premultiplied: true },
            cullMode: 'none'
        }),
        x: rand(-0.5, 0.5),
        y: rand(-0.5, 0.5),
        z: rand(-1, 1),
        useHandCursor: true
    });
    rect.setScale(rand(0.2, 0.2));
    container.addChild(rect);
}

stage.enableDOMEvent([
    Hilo3d.browser.POINTER_START,
    Hilo3d.browser.POINTER_MOVE,
    Hilo3d.browser.POINTER_END,
    'mouseover',
    'mouseout'
]);
stage.on('mouseover', e => {
    const eventTarget = 'eventTarget' in e ? e.eventTarget : undefined;
    if (eventTarget instanceof Hilo3d.Mesh && eventTarget.material) {
        eventTarget.material.opacity = 0.5;
        const hitPoint = 'hitPoint' in e ? e.hitPoint : undefined;
        if (hitPoint instanceof Hilo3d.Vector3) console.log('mesh', hitPoint.elements);
    }
});

stage.on('mouseout', e => {
    const eventTarget = 'eventTarget' in e ? e.eventTarget : undefined;
    if (eventTarget instanceof Hilo3d.Mesh && eventTarget.material) {
        eventTarget.material.opacity = 1;
    }
});
