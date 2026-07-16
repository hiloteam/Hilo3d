import { describe, expect, it } from 'vitest';
import { RendererDiagnostics } from '../../../src/render/RendererDiagnostics';
import {
    getRegisteredRendererDiagnostics,
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';

describe('RendererDiagnosticsRegistry', () => {
    it('registers one stable setup channel per canvas and supports guarded cleanup', () => {
        const canvas = document.createElement('canvas');
        const diagnostics = new RendererDiagnostics();
        const stale = new RendererDiagnostics();

        expect(getRegisteredRendererDiagnostics(canvas)).toBeNull();
        expect(registerRendererDiagnostics(canvas, diagnostics)).toBe(diagnostics);
        expect(registerRendererDiagnostics(canvas, diagnostics)).toBe(diagnostics);
        expect(getRegisteredRendererDiagnostics(canvas)).toBe(diagnostics);
        expect(() => registerRendererDiagnostics(canvas, stale)).toThrow(
            'already registered for this canvas'
        );
        expect(unregisterRendererDiagnostics(canvas, stale)).toBe(false);
        expect(getRegisteredRendererDiagnostics(canvas)).toBe(diagnostics);
        expect(unregisterRendererDiagnostics(canvas, diagnostics)).toBe(true);
        expect(getRegisteredRendererDiagnostics(canvas)).toBeNull();
        expect(unregisterRendererDiagnostics(canvas)).toBe(false);
    });

    it('can allocate the opt-in diagnostics instance explicitly at registration time', () => {
        const canvas = document.createElement('canvas');

        const diagnostics = registerRendererDiagnostics(canvas);

        expect(diagnostics).toBeInstanceOf(RendererDiagnostics);
        expect(getRegisteredRendererDiagnostics(canvas)).toBe(diagnostics);
        expect(unregisterRendererDiagnostics(canvas)).toBe(true);
    });
});
