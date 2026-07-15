import { expect, type MatcherResult } from 'vitest';

const epsilon = 1e-7;

function readNumericValues(received: unknown): number[] | undefined {
    if (
        (!Array.isArray(received) && !ArrayBuffer.isView(received)) ||
        received instanceof DataView
    ) {
        return undefined;
    }

    const values = Array.from(received as ArrayLike<unknown>);
    return values.every((value): value is number => typeof value === 'number') ? values : undefined;
}

function toEqualishValues(received: unknown, ...expected: number[]): MatcherResult {
    const actual = readNumericValues(received);
    const pass =
        actual?.length === expected.length &&
        actual.every((value, index) => {
            const expectedValue = expected[index];
            return expectedValue !== undefined && Math.abs(value - expectedValue) < epsilon;
        });

    return {
        pass,
        actual: received,
        expected,
        message: () =>
            pass
                ? `expected ${JSON.stringify(actual)} not to approximately equal ${JSON.stringify(expected)}`
                : `expected ${JSON.stringify(actual)} to approximately equal ${JSON.stringify(expected)}`
    };
}

function toBeEqualish(received: unknown, expected: number): MatcherResult {
    const pass =
        typeof received === 'number' &&
        (Number.isNaN(received) && Number.isNaN(expected)
            ? true
            : Math.abs(received - expected) < epsilon);

    return {
        pass,
        actual: received,
        expected,
        message: () =>
            pass
                ? `expected ${String(received)} not to approximately equal ${String(expected)}`
                : `expected ${String(received)} to approximately equal ${String(expected)}`
    };
}

expect.extend({ toBeEqualish, toEqualishValues });

declare module 'vitest' {
    interface Assertion<T> {
        toBeEqualish(expected: number): T;
        toEqualishValues(...expected: number[]): T;
    }
}

const stageElement = document.createElement('div');
stageElement.id = 'stage';
document.body.append(stageElement);
