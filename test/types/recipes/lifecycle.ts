import { type Stage, Ticker } from 'hilo3d';

export interface RunningScene {
    readonly stage: Stage;
    destroy(): void;
}

/** Own ticking, resize listeners and persisted-page navigation in one place. */
export function runScene(stage: Stage, resize: () => void, dispose?: () => void): RunningScene {
    const ticker = new Ticker(60);
    let destroyed = false;
    const onHide = (event: PageTransitionEvent): void => {
        if (event.persisted) ticker.stop();
        else destroy();
    };
    const onShow = (event: PageTransitionEvent): void => {
        if (event.persisted && !destroyed) {
            resize();
            ticker.start();
        }
    };
    function destroy(): void {
        if (destroyed) return;
        destroyed = true;
        ticker.stop();
        ticker.removeTick(stage);
        window.removeEventListener('resize', resize);
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('pageshow', onShow);
        try {
            dispose?.();
        } finally {
            stage.destroy();
        }
    }
    try {
        resize();
        ticker.addTick(stage);
        window.addEventListener('resize', resize);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('pageshow', onShow);
        ticker.start();
    } catch (error: unknown) {
        destroy();
        throw error;
    }
    return { stage, destroy };
}
