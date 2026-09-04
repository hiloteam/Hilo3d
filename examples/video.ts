import { Color, PBRMaterial, PlaneGeometry, Texture, constants } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
const video = document.querySelector<HTMLVideoElement>('#video');
if (!video) throw new Error('Video example requires #video.');
const response = await fetch(new URL('./video/sintel.mp4', import.meta.url));
if (!response.ok) throw new Error(`Video request failed with status ${String(response.status)}.`);
const sourceUrl = URL.createObjectURL(await response.blob());
video.src = sourceUrl;
video.load();
await new Promise<void>((resolve, reject) => {
    video.addEventListener(
        'canplay',
        () => {
            resolve();
        },
        { once: true }
    );
    video.addEventListener(
        'error',
        () => {
            reject(new Error('Video could not be decoded.'));
        },
        {
            once: true
        }
    );
});
void video.play().catch(() => {
    document.body.addEventListener('click', () => void video.play(), { once: true });
});
window.addEventListener(
    'pagehide',
    () => {
        URL.revokeObjectURL(sourceUrl);
    },
    { once: true }
);
const texture = new Texture({
    image: video,
    wrapS: constants.CLAMP_TO_EDGE,
    wrapT: constants.CLAMP_TO_EDGE,
    autoUpdate: true
});
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry({ width: 3.9, height: 2.2 }),
    material: new PBRMaterial({
        emission: texture,
        emissionFactor: new Color(1, 1, 1),
        baseColor: new Color(0, 0, 0)
    })
});
runtime.start();
