import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const AxisNetHelper = Hilo3d.AxisNetHelper;

describe('AxisNetHelper', () => {
    it('create', () => {
        const helper = new AxisNetHelper();
        expect(helper.isAxisNetHelper).toBe(true);
        expect(helper.className).toBe('AxisNetHelper');
    });
});
