/** Shared physical-atlas convention, exercised by portable asymmetric attachment fixtures. */
export const VIRTUAL_SHADOW_ATLAS_POSITION_SOURCE = `
vec2 hiloVirtualShadowAtlasNDC(vec2 pageUV, vec2 physicalPage, vec2 atlasSlots) {
    vec2 topLeftAtlasUV = (physicalPage + pageUV) / atlasSlots;
    return vec2(topLeftAtlasUV.x * 2.0 - 1.0, 1.0 - topLeftAtlasUV.y * 2.0);
}`;

export const VIRTUAL_SHADOW_ATLAS_SAMPLING_SOURCE = `
vec2 hiloVirtualShadowAtlasSampleUV(vec2 topLeftAtlasUV) {
    // This atlas addresses physical framebuffer rows and page-local UVs from the top-left.
    // Convert that local convention to the attachment projection UV expected by this shadow
    // path, then cross hiloRenderTargetUV once. Managed image UVs remain top-left throughout.
    return hiloRenderTargetUV(vec2(topLeftAtlasUV.x, 1.0 - topLeftAtlasUV.y));
}`;
