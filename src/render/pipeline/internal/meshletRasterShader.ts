import StorageGraphicsShader from '../../compute/StorageGraphicsShader';

const shaders = new WeakMap<StorageGraphicsShader, StorageGraphicsShader>();

/** Share the complete material/depth/motion implementation, replacing only its vertex fetch ABI. */
export function meshletRasterShader(source: StorageGraphicsShader): StorageGraphicsShader {
    const cached = shaders.get(source);
    if (cached !== undefined) return cached;
    const binding =
        Math.max(
            -1,
            ...source.bindings.filter(item => item.group === 0).map(item => item.binding)
        ) + 1;
    const fetch = `
layout(std430) readonly buffer MeshletGeometryBlock { uint values[]; } meshletGeometry;
uint meshletVertexBase() {
    uint cluster = visibleIndices.values[(visibleOffset.value + uint(gl_InstanceIndex)) * 3u + 1u];
    uint corner = uint(gl_VertexIndex);
    uint count = meshletGeometry.values[cluster + 13u];
    uint indexOffset = meshletGeometry.values[cluster + 12u];
    uint vertex = meshletGeometry.values[indexOffset + (corner < count ? corner : 0u)];
    return meshletGeometry.values[cluster + 14u] + vertex * 8u;
}
vec3 meshletPosition() {
    uint base = meshletVertexBase();
    return uintBitsToFloat(uvec3(meshletGeometry.values[base], meshletGeometry.values[base + 1u], meshletGeometry.values[base + 2u]));
}
vec3 meshletNormal() {
    uint base = meshletVertexBase() + 3u;
    return uintBitsToFloat(uvec3(meshletGeometry.values[base], meshletGeometry.values[base + 1u], meshletGeometry.values[base + 2u]));
}
vec2 meshletUV() {
    uint base = meshletVertexBase() + 6u;
    return uintBitsToFloat(uvec2(meshletGeometry.values[base], meshletGeometry.values[base + 1u]));
}
#define a_position meshletPosition()
#define a_normal meshletNormal()
#define a_uv0 meshletUV()
`;
    let vertexSource = source.vertexSource
        .replace('layout(location=0) in vec3 a_position;', fetch)
        .replace('layout(location=1) in vec3 a_normal;', '')
        .replace('layout(location=2) in vec2 a_uv0;', '')
        .replace(
            'visibleIndices.values[visibleOffset.value + uint(gl_InstanceIndex)]',
            'visibleIndices.values[(visibleOffset.value + uint(gl_InstanceIndex)) * 3u]'
        )
        .replace(
            'previousVisibility.values[objectIndex] == 1u',
            'previousVisibility.values[objectIndex] == 2u && visibleIndices.values[(visibleOffset.value + uint(gl_InstanceIndex)) * 3u + 2u] != 0u'
        );
    if (
        vertexSource === source.vertexSource ||
        vertexSource.includes(' in vec4 a_tangent;') ||
        vertexSource.includes(' in vec2 a_uv1;')
    ) {
        throw new TypeError(
            'Meshlet raster requires the built-in position/normal/UV0 vertex contract'
        );
    }
    // Declared storage order is shared by every semantic pass; the new block is last.
    vertexSource = vertexSource.replace(
        '#define a_position',
        '// Meshlet positions retain the shared logical UV normalization boundary.\n#define a_position'
    );
    const shader = new StorageGraphicsShader({
        label: `${source.label} meshlet vertex pulling`,
        vertexSource,
        fragmentSource: source.fragmentSource,
        bindings: [
            ...source.bindings,
            { name: 'meshletGeometry', group: 0, binding, kind: 'read-only-storage-buffer' }
        ]
    });
    shaders.set(source, shader);
    return shader;
}
