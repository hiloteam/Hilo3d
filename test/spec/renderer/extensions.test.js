const extensions = Hilo3d.extensions;

describe('extensions', () => {
    it('init', () => {
        extensions.init(testEnv.gl);

        extensions.instanced.should.equal(testEnv.gl.getExtension('ANGLE_instanced_arrays'));
        extensions.vao.should.equal(testEnv.gl.getExtension('OES_vertex_array_object'));
        extensions.texFloat.should.equal(testEnv.gl.getExtension('OES_texture_float'));
        extensions.loseContext.should.equal(testEnv.gl.getExtension('WEBGL_lose_context'));
        extensions.uintIndices.should.equal(testEnv.gl.getExtension('OES_element_index_uint'));
    });

    it('enable & disable', () => {
        extensions.disable('ANGLE_instanced_arrays');
        should(extensions.get('ANGLE_instanced_arrays')).be.null();
        extensions.enable('ANGLE_instanced_arrays');
        should(extensions.get('ANGLE_instanced_arrays')).not.be.null();
    });
});