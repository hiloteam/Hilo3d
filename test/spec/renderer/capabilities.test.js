const capabilities = Hilo3d.capabilities;

describe('capabilities', () => {
    let gl = testEnv.gl;

    it('init', () => {
        capabilities.init(gl);

        [
            'MAX_RENDERBUFFER_SIZE',
            'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
            'MAX_CUBE_MAP_TEXTURE_SIZE',
            'MAX_FRAGMENT_UNIFORM_VECTORS',
            'MAX_TEXTURE_IMAGE_UNITS',
            'MAX_TEXTURE_SIZE',
            'MAX_VARYING_VECTORS',
            'MAX_VERTEX_ATTRIBS',
            'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
            'MAX_VERTEX_UNIFORM_VECTORS',
            'MAX_COMBINED_TEXTURE_IMAGE_UNITS'
        ].forEach((name) => {
            capabilities[name].should.equal(gl.getParameter(gl[name]));
        });
    });

    it('getMaxPrecision', () => {
        capabilities.getMaxPrecision('highp', 'highp').should.equal('highp');
        capabilities.getMaxPrecision('highp', 'mediump').should.equal('mediump');
        capabilities.getMaxPrecision('highp', 'lowp').should.equal('lowp');

        capabilities.getMaxPrecision('mediump', 'highp').should.equal('mediump');
        capabilities.getMaxPrecision('mediump', 'mediump').should.equal('mediump');
        capabilities.getMaxPrecision('mediump', 'lowp').should.equal('lowp');

        capabilities.getMaxPrecision('lowp', 'highp').should.equal('lowp');
        capabilities.getMaxPrecision('lowp', 'mediump').should.equal('lowp');
        capabilities.getMaxPrecision('lowp', 'lowp').should.equal('lowp');
    });

    it('get', () => {
        capabilities.get('MAX_VERTEX_TEXTURE_IMAGE_UNITS').should.equal(gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS));
    });
});