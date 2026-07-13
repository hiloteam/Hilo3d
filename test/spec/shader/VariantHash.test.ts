import { describe, expect, it } from 'vitest';
import {
    CollisionSafeVariantKeyRegistry,
    hashVariantValues
} from '../../../src/shader/VariantHash';

describe('shader variant hashing', () => {
    it('is stable, typed, and structurally delimited', () => {
        const values = ['material', 3, true, null, undefined] as const;

        expect(hashVariantValues(values)).toBe(hashVariantValues(values));
        expect(hashVariantValues(['ab', 'c'])).not.toBe(hashVariantValues(['a', 'bc']));
        expect(hashVariantValues(['1'])).not.toBe(hashVariantValues([1]));
        expect(hashVariantValues(['A', 1])).not.toBe(hashVariantValues([1, 'A']));
        expect(hashVariantValues(values)).toMatch(/^[\da-f]{16}$/);
    });

    it('checks exact fields and isolates forced hash collisions', () => {
        const registry = new CollisionSafeVariantKeyRegistry(() => 'forced-collision');

        const first = registry.resolve('shader', ['material-a', 'geometry-a', 1]);
        const repeated = registry.resolve('shader', ['material-a', 'geometry-a', 1]);
        const collided = registry.resolve('shader', ['material-b', 'geometry-b', 2]);

        expect(repeated).toBe(first);
        expect(collided).not.toBe(first);
        expect(first).toBe('shader:forced-collision');
        expect(collided).toBe('shader:forced-collision.1');

        registry.release(first);
        const recreated = registry.resolve('shader', ['material-a', 'geometry-a', 1]);
        expect(recreated).toBe('shader:forced-collision.2');
        expect(recreated).not.toBe(collided);
    });

    it('can hash fingerprints while retaining original values for collision checks', () => {
        const registry = new CollisionSafeVariantKeyRegistry(() => 'same-digest');

        const first = registry.resolve('source', ['long-source-a'], ['fingerprint']);
        const second = registry.resolve('source', ['long-source-b'], ['fingerprint']);

        expect(second).not.toBe(first);
        expect(registry.resolve('source', ['long-source-a'], ['fingerprint'])).toBe(first);
    });
});
