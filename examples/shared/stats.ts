import type RenderInfo from '../../src/renderer/common/RenderInfo';
import type Ticker from '../../src/utils/Ticker';

interface PerformanceMemory {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
    memory?: PerformanceMemory;
}

/** Lightweight renderer statistics overlay used by the examples. */
class Stats {
    readonly ticker: Ticker;
    readonly renderInfo: RenderInfo;
    readonly container: HTMLElement;
    private intervalId: number | undefined;

    constructor(ticker: Ticker, renderInfo: RenderInfo, container?: HTMLElement) {
        this.ticker = ticker;
        this.renderInfo = renderInfo;
        this.container = container ?? this.createContainer();
        this.start();
    }

    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'hilo3dStats';
        container.style.cssText = [
            'position:absolute',
            'left:5px',
            'top:5px',
            'color:#000',
            'font-size:12px',
            'z-index:999999'
        ].join(';');
        document.body.appendChild(container);
        return container;
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

    getMemoryInfo(): string {
        const memory = (window.performance as PerformanceWithMemory).memory;
        if (!memory) return 'memory: NaN';
        const percentage = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
        return `memory: ${percentage.toFixed(2)}%`;
    }

    start(): void {
        if (this.intervalId !== undefined) window.clearInterval(this.intervalId);
        this.intervalId = window.setInterval(() => {
            this.container.innerHTML = [
                this.getFpsInfo(),
                this.getFaceCountInfo(),
                this.getDrawCountInfo(),
                this.getMemoryInfo()
            ].join('<br>');
        }, 1000);
    }

    stop(): void {
        if (this.intervalId === undefined) return;
        window.clearInterval(this.intervalId);
        this.intervalId = undefined;
    }
}

export default Stats;
