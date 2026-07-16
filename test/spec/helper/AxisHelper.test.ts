import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const AxisHelper = Hilo3d.AxisHelper;

describe('AxisHelper', () => {
    it('create', () => {
        const helper = new AxisHelper();
        expect(helper.isAxisHelper).toBe(true);
        expect(helper.className).toBe('AxisHelper');
    });
});
