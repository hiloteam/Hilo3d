struct VertexOutput {
    @builtin(position) position: vec4<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
    return output;
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let sourceSize = vec2<i32>(textureDimensions(sourceTexture));
    let maximum = sourceSize - vec2<i32>(1);
    let base = min(vec2<i32>(position.xy) * 2, maximum);
    let right = min(base + vec2<i32>(1, 0), maximum);
    let bottom = min(base + vec2<i32>(0, 1), maximum);
    let bottomRight = min(base + vec2<i32>(1, 1), maximum);
    return (
        textureLoad(sourceTexture, base, 0) +
        textureLoad(sourceTexture, right, 0) +
        textureLoad(sourceTexture, bottom, 0) +
        textureLoad(sourceTexture, bottomRight, 0)
    ) * 0.25;
}
