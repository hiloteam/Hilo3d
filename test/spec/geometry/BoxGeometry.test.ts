import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const BoxGeometry = Hilo3d.BoxGeometry;

describe('BoxGeometry', () => {
    it('create', () => {
        const geometry = new BoxGeometry();
        expect(geometry.isBoxGeometry).toBe(true);
        expect(geometry.className).toBe('BoxGeometry');
    });
});
