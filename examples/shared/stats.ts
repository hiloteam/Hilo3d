import type Renderer from '../../src/render/Renderer';
import type RenderInfo from '../../src/render/RenderInfo';
import type Ticker from '../../src/utils/Ticker';

interface PerformanceMemory {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
    memory?: PerformanceMemory;
}

const RENDER_BACKEND_LABELS: Readonly<Record<Renderer['backend'], string>> = Object.freeze({
    webgl2: 'WebGL 2',
    webgpu: 'WebGPU'
});

/** Lightweight renderer statistics overlay used by the examples. */
class Stats {
    readonly ticker: Ticker;
    readonly renderer: Renderer;
    readonly renderInfo: RenderInfo;
    readonly container: HTMLElement;
    private intervalId: number | undefined;

    constructor(ticker: Ticker, renderer: Renderer, container?: HTMLElement) {
        this.ticker = ticker;
        this.renderer = renderer;
        this.renderInfo = renderer.renderInfo;
        this.container = container ?? this.createContainer();
        this.container.classList.add('hilo3dStats');
        this.container.setAttribute('role', 'group');
        this.container.setAttribute('aria-label', 'Renderer statistics');
        this.start();
    }

    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        document.body.appendChild(container);
        return container;
    }

    getRenderBackendInfo(): string {
        return `renderBackend: ${RENDER_BACKEND_LABELS[this.renderer.backend]}`;
    }

    getFpsInfo(): string {
        return `fps: ${String(this.ticker.getMeasuredFPS())}`;
    }

    getFaceCountInfo(): string {
        return `faceCount: ${String(this.renderInfo.faceCount)}`;
    }

    getDrawCountInfo(): string {
        return `drawCount: ${String(this.renderInfo.drawCount)}`;
    }

    getMemoryInfo(): string | null {
        const memory = (window.performance as PerformanceWithMemory).memory;
        if (!memory) return null;
        const percentage = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
        return `memory: ${percentage.toFixed(2)}%`;
    }

    private update(): void {
        const memory = this.getMemoryInfo();
        this.container.textContent = [
            this.getRenderBackendInfo(),
            this.getFpsInfo(),
            this.getFaceCountInfo(),
            this.getDrawCountInfo(),
            ...(memory ? [memory] : [])
        ].join('\n');
    }

    start(): void {
        if (this.intervalId !== undefined) window.clearInterval(this.intervalId);
        this.update();
        this.intervalId = window.setInterval(() => {
            this.update();
        }, 1000);
    }

    stop(): void {
        if (this.intervalId === undefined) return;
        window.clearInterval(this.intervalId);
        this.intervalId = undefined;
    }
}

export default Stats;
