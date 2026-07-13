import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const { Class } = Hilo3d;

interface BaseShape {
    id: string;
    getId(): string;
}

type BaseConstructor = new () => BaseShape;

const LegacyBase = Class.create<BaseConstructor>()({
    id: 'a',
    getId() {
        return this.id;
    }
});

describe('Class compatibility API', () => {
    it('creates constructible classes', () => {
        const instance = new LegacyBase();
        expect(instance).toBeInstanceOf(LegacyBase);
        expect(instance.id).toBe('a');
        expect(instance.getId()).toBe('a');
    });

    it('preserves prototype inheritance', () => {
        type DerivedConstructor = new () => BaseShape;

        const LegacyDerived = Class.create<DerivedConstructor>()({
            id: 'b',
            Extends: LegacyBase
        });
        const instance = new LegacyDerived();

        expect(instance).toBeInstanceOf(LegacyBase);
        expect(instance).toBeInstanceOf(LegacyDerived);
        expect(LegacyDerived.superclass).toBe(LegacyBase.prototype);
        expect(instance.id).toBe('b');
        expect(instance.getId()).toBe('b');
    });

    it('mixes typed members into the prototype', () => {
        interface MixedShape {
            mixA: string;
            mixB(): string;
        }
        type MixedConstructor = new () => MixedShape;

        const MixedClass = Class.create<MixedConstructor>()({
            Mixes: [
                { mixA: 'mixA' },
                {
                    mixB() {
                        return 'mixB';
                    }
                }
            ]
        });
        const instance = new MixedClass();

        expect(instance.mixA).toBe('mixA');
        expect(instance.mixB()).toBe('mixB');
    });

    it('copies typed static members', () => {
        interface StaticConstructor {
            new (): object;
            hello(): string;
        }

        const StaticClass = Class.create<StaticConstructor>()({
            Statics: {
                hello() {
                    return 'hello';
                }
            }
        });

        expect(StaticClass.hello()).toBe('hello');
    });
});
