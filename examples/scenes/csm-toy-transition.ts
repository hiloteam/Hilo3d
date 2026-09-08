/** Wall-clock fade that can reverse from its current value while toy animation is paused. */
export class CsmToyTransition {
    private from: number;
    private target: number;
    private startedAt = 0;
    private value: number;
    complete = true;

    constructor(
        initial: number,
        private readonly duration: number
    ) {
        this.from = initial;
        this.target = initial;
        this.value = initial;
    }

    setTarget(target: number, now = performance.now(), delay = 0): void {
        if (target === this.target) return;
        this.from = this.sample(now);
        this.target = target;
        this.startedAt = now + delay;
        this.complete = this.from === target;
    }

    sample(now = performance.now()): number {
        if (this.complete) return this.value;
        const progress = Math.max(0, Math.min(1, (now - this.startedAt) / this.duration));
        const eased = progress * progress * (3 - 2 * progress);
        this.value = this.from + (this.target - this.from) * eased;
        this.complete = progress === 1;
        return this.value;
    }
}
