import { describe, expect, it } from 'vitest';
import constants from '../../../src/constants';
import * as webgl from '../../../src/constants/webgl';
import * as webglExtensions from '../../../src/constants/webglExtensions';

function expectConstantsToBeReexported(source: object): void {
    for (const [name, value] of Object.entries(source)) {
        expect(Reflect.get(constants, name)).toBe(value);
    }
}

describe('constants/index', () => {
    it('re-exports WebGL constants', () => {
        expectConstantsToBeReexported(webgl);
    });

    it('re-exports WebGL extension constants', () => {
        expectConstantsToBeReexported(webglExtensions);
    });
});
