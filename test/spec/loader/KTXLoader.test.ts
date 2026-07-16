import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const KTXLoader = Hilo3d.KTXLoader;

describe('KTXLoader', () => {
    it('create', () => {
        const loader = new KTXLoader();
        expect(loader.isKTXLoader).toBe(true);
        expect(loader.className).toBe('KTXLoader');
    });
});
