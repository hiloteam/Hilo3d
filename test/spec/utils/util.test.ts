import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const util = Hilo3d.util;

describe('util', () => {
    function asc(a: number, b: number): number {
        return a - b;
    }

    function desc(a: number, b: number): number {
        return b - a;
    }

    describe('getIndexFromSortedArray', function () {
        it('undefined', function () {
            const indexArr = util.getIndexFromSortedArray(undefined, 1, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([0, 0]);
        });
        it('should be 0, 0', function () {
            const indexArr = util.getIndexFromSortedArray([], 1, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([0, 0]);
        });
        it('single item asc same', function () {
            const indexArr = util.getIndexFromSortedArray([1], 1, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([0, 0]);
        });
        it('single item asc higher', function () {
            const indexArr = util.getIndexFromSortedArray([1], 2, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([0, 1]);
        });
        it('single item asc lower', function () {
            const indexArr = util.getIndexFromSortedArray([1], 0, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([-1, 0]);
        });

        it('single item dest same', function () {
            const indexArr = util.getIndexFromSortedArray([1], 1, desc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([0, 0]);
        });
        it('single item dest higher', function () {
            const indexArr = util.getIndexFromSortedArray([1], 2, desc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([-1, 0]);
        });
        it('single item dest lower', function () {
            const indexArr = util.getIndexFromSortedArray([1], 0, desc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([0, 1]);
        });

        it('two items asc same', function () {
            let indexArr = util.getIndexFromSortedArray([1, 3], 1, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([0, 0]);

            indexArr = util.getIndexFromSortedArray([1, 3], 3, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([1, 1]);
        });
        it('two items asc higher', function () {
            const indexArr = util.getIndexFromSortedArray([1, 3], 5, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([1, 2]);
        });
        it('two items asc middle', function () {
            const indexArr = util.getIndexFromSortedArray([1, 3], 2, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([0, 1]);
        });
        it('two items asc lower', function () {
            const indexArr = util.getIndexFromSortedArray([1, 3], 0, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([-1, 0]);
        });

        it('two items dest same', function () {
            let indexArr = util.getIndexFromSortedArray([3, 1], 1, desc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([1, 1]);

            indexArr = util.getIndexFromSortedArray([3, 1], 3, desc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([0, 0]);
        });
        it('two items dest higher', function () {
            const indexArr = util.getIndexFromSortedArray([3, 1], 5, desc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([-1, 0]);
        });
        it('two items dest middle', function () {
            const indexArr = util.getIndexFromSortedArray([3, 1], 2, desc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([0, 1]);
        });
        it('two items dest lower', function () {
            const indexArr = util.getIndexFromSortedArray([3, 1], 0, desc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([1, 2]);
        });

        it('complex asc', function () {
            const arr: number[] = [];
            const count = 24;
            for (let i = 0; i < count; i += 1) {
                arr.push(i);
            }

            for (let value = 0; value < count; value += 1) {
                let indexArr = util.getIndexFromSortedArray(arr, value, asc);
                expect(indexArr.length).toBe(2);
                expect(indexArr).toEqual([value, value]);

                indexArr = util.getIndexFromSortedArray(arr, value + 0.5, asc);
                expect(indexArr.length).toBe(2);
                expect(indexArr).toEqual([value, value + 1]);
            }

            let indexArr = util.getIndexFromSortedArray(arr, -1, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([-1, 0]);

            indexArr = util.getIndexFromSortedArray(arr, count + 1, asc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([count - 1, count]);
        });
        it('complex dest', function () {
            const arr: number[] = [];
            const count = 24;
            for (let i = 0; i < count; i += 1) {
                arr.push(i);
            }
            arr.reverse();

            for (let value = 0; value < count; value += 1) {
                let indexArr = util.getIndexFromSortedArray(arr, value, desc);
                expect(indexArr.length).toBe(2);
                expect(indexArr).toEqual([count - 1 - value, count - 1 - value]);

                indexArr = util.getIndexFromSortedArray(arr, value + 0.5, desc);
                expect(indexArr.length).toBe(2);
                expect(indexArr).toEqual([count - 1 - value - 1, count - 1 - value]);
            }

            let indexArr = util.getIndexFromSortedArray(arr, -1, desc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([count - 1, count]);

            indexArr = util.getIndexFromSortedArray(arr, count + 1, desc);
            expect(indexArr.length).toBe(2);
            expect(indexArr).toEqual([-1, 0]);
        });
    });
});
