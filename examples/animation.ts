import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const context = await createExampleContext();
const { stage, ticker, directionLight, orbitControls } = context;
directionLight.amount = 0.8;
orbitControls.setView(new Hilo3d.Vector3(4, 2.6, 5.5), new Hilo3d.Vector3(0, 0.7, 0));
const actor = new Hilo3d.Node({ name: 'actor' }).addTo(stage);
const body = new Hilo3d.Node({ name: 'body', y: 0.65 }).addTo(actor);
const head = new Hilo3d.Node({ name: 'head', y: 0.5, z: 0.45 }).addTo(body);
const geometry = new Hilo3d.BoxGeometry();
function box(
    parent: Hilo3d.Node,
    color: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number
): Hilo3d.Mesh {
    return new Hilo3d.Mesh({
        geometry,
        material: new Hilo3d.BasicMaterial({
            diffuse: new Hilo3d.Color(
                ((color >> 16) & 255) / 255,
                ((color >> 8) & 255) / 255,
                (color & 255) / 255
            )
        }),
        x,
        y,
        z,
        scaleX: sx,
        scaleY: sy,
        scaleZ: sz
    }).addTo(parent);
}
box(body, 0xd9a36a, 0, 0.05, 0, 0.75, 0.55, 1);
box(head, 0xf2c98f, 0, 0, 0, 0.7, 0.6, 0.65);
box(head, 0x443126, -0.22, 0.49, 0, 0.18, 0.55, 0.18);
box(head, 0x443126, 0.22, 0.49, 0, 0.18, 0.55, 0.18);
box(head, 0x151920, -0.19, 0.03, 0.34, 0.08, 0.1, 0.035);
box(head, 0x151920, 0.19, 0.03, 0.34, 0.08, 0.1, 0.035);
const feet: Hilo3d.Node[] = [];
for (let i = 0; i < 4; i++) {
    const foot = new Hilo3d.Node({
        name: `foot${String(i)}`,
        x: i % 2 ? 0.25 : -0.25,
        y: -0.2,
        z: i < 2 ? 0.32 : -0.32
    }).addTo(body);
    box(foot, 0x8d6147, 0, -0.18, 0, 0.2, 0.4, 0.22);
    feet.push(foot);
}
box(stage, 0x334f48, 0, -0.1, 0, 7, 0.15, 5);
const flower = new Hilo3d.Node({ x: 2, y: 0.2, z: 0.4 }).addTo(stage);
box(flower, 0x80bda0, 0, 0.1, 0, 0.08, 0.5, 0.08);
box(flower, 0xef99c9, 0, 0.38, 0, 0.4, 0.17, 0.4);
const spark = box(flower, 0xffee9a, 0, 0.8, 0, 0.2, 0.2, 0.2);
spark.visible = false;
let flash = 0;
let effectCount = 0;

function motion(
    name: string,
    duration: number,
    stride: number,
    bounce: number
): Hilo3d.AnimationClip {
    const times = Array.from({ length: 17 }, (_, i) => (i * duration) / 16);
    const tracks: Hilo3d.AnimationTrack[] = feet.map(
        (foot, index) =>
            new Hilo3d.AnimationTrack({
                target: foot.name,
                property: 'rotation',
                times,
                values: times.flatMap(time => {
                    const angle =
                        Math.sin(
                            (time / duration) * Math.PI * 2 +
                                (index === 0 || index === 3 ? 0 : Math.PI)
                        ) * stride;
                    return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
                })
            })
    );
    tracks.push(
        new Hilo3d.AnimationTrack({
            target: 'body',
            property: 'translation',
            times,
            values: times.flatMap(time => [
                0,
                0.65 + (1 - Math.cos((time / duration) * Math.PI * 4)) * bounce,
                0
            ])
        })
    );
    tracks.push(
        new Hilo3d.AnimationTrack({
            target: 'body',
            property: 'scale',
            times: [0],
            values: name === 'Sleep' ? [1.05, 0.6, 1.05] : [1, 1, 1]
        })
    );
    return new Hilo3d.AnimationClip({
        name,
        tracks,
        markers: name === 'Attack' ? [{ name: 'flower-spark', time: duration * 0.45 }] : []
    });
}
const idle = motion('Idle', 2, 0, 0.012);
const walk = motion('Walk', 1.2, 0.4, 0.035);
const run = motion('Run', 0.65, 0.9, 0.08);
const happy = motion('Happy', 0.8, 0.2, 0.22);
const sleep = motion('Sleep', 3, 0, 0.012);
const attack = motion('Attack', 0.6, 1.2, 0.12);
const clips = [idle, walk, run, happy, sleep, attack];
const animation = new Hilo3d.Animation({ rootNode: actor, clips });
actor.setAnim(animation);
const locomotion = new Hilo3d.AnimationBlendTree1D('Locomotion', 'speed', [
    { threshold: 0, clip: idle },
    { threshold: 1, clip: walk },
    { threshold: 2.4, clip: run }
]);
const layer = animation.addLayer({
    name: 'body',
    motions: [locomotion, idle, walk, run, happy, sleep, attack],
    onEvent(event) {
        if (event.name === 'flower-spark') {
            flash = 0.45;
            effectCount++;
            spark.visible = true;
        }
    }
});
layer.play('Locomotion');

const panel = document.createElement('section');
panel.style.cssText =
    'position:fixed;right:24px;top:24px;width:260px;padding:22px;background:#17232ded;color:#f5ead9;font:14px/1.6 system-ui;border:1px solid #566459;border-radius:16px';
panel.innerHTML = `<b style="font-size:20px">Creature animation lab</b><p>Six reusable motions. Smooth gait blending, layered attention, and a timed flower effect.</p><label>Speed <input aria-label="Speed" type="range" min="0" max="2.4" step="0.01" value="0"></label><p id="motion-status" aria-live="polite">Locomotion</p><div id="motion-buttons"></div><p><label>Personality pace <input aria-label="Playback rate" type="range" min="0.5" max="1.5" step="0.05" value="1"></label></p><label>Head attention <input aria-label="Head attention" type="range" min="-1" max="1" step="0.01" value="0"></label>`;
document.body.append(panel);
function input(label: string): HTMLInputElement {
    const element = panel.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!element) throw new Error('Animation control missing');
    return element;
}
const status = panel.querySelector('#motion-status');
const buttons = panel.querySelector('#motion-buttons');
if (!status || !buttons) throw new Error('Animation panel missing');
for (const name of ['Idle', 'Walk', 'Run', 'Happy', 'Sleep', 'Attack']) {
    const button = document.createElement('button');
    button.textContent = name;
    button.style.cssText =
        'padding:7px 10px;margin:3px;border-radius:6px;border:0;background:#e7bf88;color:#202d30;cursor:pointer';
    button.addEventListener('click', () => {
        layer.play(name, {
            fade: 0.3,
            synchronize: name === 'Walk' || name === 'Run',
            loop: name !== 'Happy' && name !== 'Attack'
        });
    });
    buttons.append(button);
}
input('Speed').addEventListener('input', () => {
    layer.play('Locomotion', { fade: 0.3, synchronize: true });
});
input('Playback rate').addEventListener('input', () => {
    layer.playbackRate = Number(input('Playback rate').value);
});
function look(name: string, angle: number): Hilo3d.AnimationClip {
    return new Hilo3d.AnimationClip({
        name,
        tracks: [
            new Hilo3d.AnimationTrack({
                target: 'head',
                property: 'rotation',
                times: [0],
                values: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]
            })
        ]
    });
}
const attention = new Hilo3d.AnimationBlendTree1D('Look', 'attention', [
    { threshold: -1, clip: look('left', -0.7) },
    { threshold: 1, clip: look('right', 0.7) }
]);
animation
    .addLayer({ name: 'attention', mode: 'additive', mask: { head: 1 }, motions: [attention] })
    .play('Look');
animation.setParameter('speed', 0);
ticker.addTick({
    tick(milliseconds: number): void {
        const seconds = milliseconds / 1000;
        animation.setParameter('speed', Number(input('Speed').value), 0.12, seconds);
        animation.setParameter('attention', Number(input('Head attention').value));
        flash = Math.max(0, flash - seconds);
        animation.update(seconds);
        if (layer.finished) layer.play('Locomotion', { fade: 0.3 });
        spark.visible = flash > 0;
        spark.rotationY += milliseconds * 0.2;
        status.textContent = `${layer.currentMotion ?? 'Stopped'} · speed ${animation.getParameter('speed').toFixed(2)}`;
        document.body.dataset['animationReady'] = 'true';
        document.body.dataset['animationModel'] = 'BlockCreature';
        document.body.dataset['animationClipCount'] = String(clips.length);
        document.body.dataset['animationBodyScale'] = body.scaleY.toFixed(2);
        document.body.dataset['animationMotion'] = layer.currentMotion ?? '';
        document.body.dataset['animationEffect'] = String(spark.visible);
        document.body.dataset['animationEffectCount'] = String(effectCount);
    }
});
// Evaluate behavior and pose before scene transform collection and rendering.
ticker.removeTick(stage);
ticker.addTick(stage);
let disposed = false;
window.addEventListener('pagehide', (event: PageTransitionEvent) => {
    ticker.stop();
    if (event.persisted || disposed) return;
    disposed = true;
    animation.destroy();
    context.dispose();
});
window.addEventListener('pageshow', (event: PageTransitionEvent) => {
    if (event.persisted && !disposed) ticker.start();
});
