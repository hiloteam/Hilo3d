import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const context = await createExampleContext();
const { stage, lifecycle } = context;
const videoElement = document.querySelector<HTMLVideoElement>('#video');
if (!videoElement) throw new Error('Video example requires #video.');
const video: HTMLVideoElement = videoElement;

const request = new AbortController();
let sourceUrl: string | undefined;
let resumePlayback = true;
let playbackGeneration = 0;
let awaitingGesture = false;

function pauseVideo(): void {
    playbackGeneration++;
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) resumePlayback = !video.paused;
    video.pause();
}

function resumeVideo(event: PageTransitionEvent): void {
    if (
        event.persisted &&
        lifecycle.active &&
        resumePlayback &&
        video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
        startPlayback().catch(reportAsyncError);
    }
}

window.addEventListener('pagehide', pauseVideo);
window.addEventListener('pageshow', resumeVideo);
context.onDispose(() => {
    request.abort();
    window.removeEventListener('pagehide', pauseVideo);
    window.removeEventListener('pageshow', resumeVideo);
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
});

async function loadVideoSource(): Promise<void> {
    const response = await fetch(new URL('./video/sintel.mp4', import.meta.url), {
        signal: request.signal
    });
    if (!response.ok) {
        throw new Error(`Video request failed with status ${String(response.status)}.`);
    }
    const blob = await response.blob();
    if (lifecycle.disposed) return;
    sourceUrl = URL.createObjectURL(blob);
    video.src = sourceUrl;
    video.load();
}

async function waitForVideo(): Promise<void> {
    if (lifecycle.disposed) return;
    if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        await new Promise<void>((resolve, reject) => {
            const cleanup = (): void => {
                video.removeEventListener('canplaythrough', onReady);
                video.removeEventListener('error', onError);
                request.signal.removeEventListener('abort', onAbort);
            };
            const onReady = (): void => {
                cleanup();
                resolve();
            };
            const onError = (): void => {
                cleanup();
                reject(new Error(video.error?.message ?? 'Video could not be decoded.'));
            };
            const onAbort = (): void => {
                cleanup();
                resolve();
            };
            video.addEventListener('canplaythrough', onReady);
            video.addEventListener('error', onError);
            request.signal.addEventListener('abort', onAbort, { once: true });
        });
    }
}

async function startPlayback(): Promise<void> {
    if (!lifecycle.active || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
    const generation = playbackGeneration;
    try {
        await video.play();
    } catch (error: unknown) {
        if (
            error instanceof DOMException &&
            error.name === 'AbortError' &&
            generation !== playbackGeneration
        ) {
            return;
        }
        if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') throw error;
        if (awaitingGesture) return;
        awaitingGesture = true;
        document.body.addEventListener(
            'click',
            () => {
                awaitingGesture = false;
                startPlayback().catch(reportAsyncError);
            },
            { once: true, signal: request.signal }
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
    context.onDispose(() => {
        texture.destroy();
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
    if (lifecycle.disposed) return;
    if (!lifecycle.active && error instanceof DOMException && error.name === 'AbortError') return;
    queueMicrotask(() => {
        throw error;
    });
}

loadVideoSource()
    .then(waitForVideo)
    .then(() => {
        if (lifecycle.disposed) return undefined;
        addVideoMesh();
        return startPlayback();
    })
    .catch(reportAsyncError);
