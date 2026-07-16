import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const CameraHelper = Hilo3d.CameraHelper;

describe('CameraHelper', () => {
    it('create', () => {
        const helper = new CameraHelper();
        expect(helper.isCameraHelper).toBe(true);
        expect(helper.className).toBe('CameraHelper');
    });
});
