import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = createExampleContext();
const videoElement = document.querySelector<HTMLVideoElement>('#video');
if (!videoElement) throw new Error('Video example requires #video.');
const video: HTMLVideoElement = videoElement;

async function waitForVideo(): Promise<void> {
    if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        await new Promise<void>((resolve, reject) => {
            video.addEventListener(
                'canplaythrough',
                () => {
                    resolve();
                },
                { once: true }
            );
            video.addEventListener(
                'error',
                () => {
                    reject(new Error(video.error?.message ?? 'Video could not be decoded.'));
                },
                { once: true }
            );
        });
    }

    try {
        await video.play();
    } catch (error: unknown) {
        if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') throw error;
        document.body.addEventListener(
            'click',
            () => {
                video.play().catch(reportAsyncError);
            },
            { once: true }
        );
    }
}

function addVideoMesh(): void {
    const texture = new Hilo3d.Texture({
        image: video,
        wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.CLAMP_TO_EDGE,
        autoUpdate: true,
        flipY: true
    });
    new Hilo3d.Mesh({
        material: new Hilo3d.PBRMaterial({
            emission: texture,
            emissionFactor: new Hilo3d.Color(1, 1, 1),
            baseColor: new Hilo3d.Color(0, 0, 0)
        }),
        geometry: new Hilo3d.PlaneGeometry({ width: 1.95, height: 1.1 }),
        y: 0.03
    }).addTo(stage);
}

function reportAsyncError(error: unknown): void {
    queueMicrotask(() => {
        throw error;
    });
}

waitForVideo()
    .then(() => {
        addVideoMesh();
    })
    .catch(reportAsyncError);
