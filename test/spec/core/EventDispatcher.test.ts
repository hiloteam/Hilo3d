import { beforeEach, describe, expect, it } from 'vitest';
import { EventDispatcher } from '../../../src/core/EventDispatcher';

describe('EventDispatcher', () => {
    let eventTarget = new EventDispatcher();

    beforeEach(() => {
        eventTarget = new EventDispatcher();
    });

    it('dispatches events with details', () => {
        let firedCount = 0;
        eventTarget.on('hello', event => {
            expect(event.type).toBe('hello');
            expect(event.detail).toEqual({ data: 'world' });
            firedCount += 1;
        });

        expect(eventTarget.fire('hello', { data: 'world' })).toBe(true);
        expect(firedCount).toBe(1);
        expect(eventTarget.fire('hello', { data: 'world' })).toBe(true);
        expect(firedCount).toBe(2);
    });

    it('removes a once listener after its first event', () => {
        let firedCount = 0;
        eventTarget.on('hello', () => undefined);
        eventTarget.on(
            'hello',
            () => {
                firedCount += 1;
            },
            true
        );

        eventTarget.fire('hello');
        expect(firedCount).toBe(1);
        eventTarget.fire('hello');
        expect(firedCount).toBe(1);
    });

    it('removes all listeners, listeners by type, and individual listeners', () => {
        let firstCount = 0;
        let secondCount = 0;
        const firstListener = (): void => {
            firstCount += 1;
        };
        const secondListener = (): void => {
            secondCount += 1;
        };
        const reset = (): void => {
            firstCount = 0;
            secondCount = 0;
            eventTarget = new EventDispatcher();
            eventTarget.on('hello1', firstListener);
            eventTarget.on('hello2', secondListener);
        };

        reset();
        eventTarget.off();
        eventTarget.fire('hello1');
        eventTarget.fire('hello2');
        expect(firstCount).toBe(0);
        expect(secondCount).toBe(0);

        reset();
        eventTarget.off('hello1');
        eventTarget.fire('hello1');
        eventTarget.fire('hello2');
        expect(firstCount).toBe(0);
        expect(secondCount).toBe(1);

        reset();
        eventTarget.on('hello', firstListener);
        eventTarget.on('hello', secondListener);
        eventTarget.off('hello', firstListener);
        eventTarget.fire('hello');
        expect(firstCount).toBe(0);
        expect(secondCount).toBe(1);
    });

    it('honors stopImmediatePropagation across dispatchers', () => {
        let wasForwarded = false;
        const receivingTarget = new EventDispatcher();
        receivingTarget.on('hello', () => {
            wasForwarded = true;
        });

        eventTarget.on('hello', event => {
            if (!event.stopImmediatePropagation) {
                throw new Error('Expected dispatched events to support stopImmediatePropagation()');
            }
            event.stopImmediatePropagation();
            receivingTarget.fire(event);
        });

        eventTarget.fire('hello');
        expect(wasForwarded).toBe(false);
    });
});
