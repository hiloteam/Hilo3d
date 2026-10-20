import Ticker from '../../src/utils/Ticker';

/** Preserve scheduling intent across page suspension without allowing late work after teardown. */
export class ExampleTicker extends Ticker {
    #started = false;
    #paused = false;
    #suspended = false;
    #disposed = false;

    override start(): void {
        if (this.#disposed) return;
        this.#started = true;
        this.#paused = false;
        if (!this.#suspended) super.start();
    }

    override stop(): void {
        this.#started = false;
        this.#paused = false;
        super.stop();
    }

    override pause(): void {
        this.#paused = true;
        super.pause();
    }

    override resume(): void {
        if (this.#disposed) return;
        this.#paused = false;
        if (this.#started && !this.#suspended) super.start();
    }

    suspend(): void {
        this.#suspended = true;
        super.stop();
    }

    restore(): void {
        if (this.#disposed) return;
        this.#suspended = false;
        if (this.#started && !this.#paused) super.start();
    }

    dispose(): void {
        this.#disposed = true;
        this.stop();
    }
}
