import { describe, expect, it } from 'vitest';
import { parseNpmPackResult } from '../../../scripts/npm-pack-result';

describe('parseNpmPackResult', () => {
    it('accepts the npm array response', () => {
        expect(parseNpmPackResult('[{"filename":"hilo3d-2.0.0.tgz"}]')).toEqual({
            filename: 'hilo3d-2.0.0.tgz'
        });
    });

    it('accepts the npm package-keyed response', () => {
        expect(parseNpmPackResult('{"hilo3d":{"filename":"hilo3d-2.0.0.tgz"}}')).toEqual({
            filename: 'hilo3d-2.0.0.tgz'
        });
    });

    it.each([
        'null',
        '[]',
        '[{"filename":"first.tgz"},{"filename":"second.tgz"}]',
        '{"first":{"filename":"first.tgz"},"second":{"filename":"second.tgz"}}',
        '[{"filename":""}]',
        '[{"filename":42}]'
    ])('rejects an unexpected response: %s', output => {
        expect(() => parseNpmPackResult(output)).toThrow('Unexpected npm pack response');
    });
});
