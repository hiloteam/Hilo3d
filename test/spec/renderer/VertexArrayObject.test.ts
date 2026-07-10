const VertexArrayObject = Hilo3d.VertexArrayObject;

describe('VertexArrayObject', () => {
    it('create', () => {
        const vao = new VertexArrayObject;
        vao.isVertexArrayObject.should.be.true();
        vao.className.should.equal('VertexArrayObject');
    });

    it('cache & destroy', () => {
        const vao = VertexArrayObject.getVao(testEnv.gl, '_hiloTestVao');
        VertexArrayObject.cache.get('_hiloTestVao').should.equal(vao);
        vao.destroy();
        should(VertexArrayObject.cache.get('_hiloTestVao')).be.undefined();
        should(vao.gl).be.null();
        should(vao.indexBuffer).be.null();
        should(vao.attributes).be.null();
    });

    it('getVertexCount', () => {
        const vao = VertexArrayObject.getVao(testEnv.gl, '_hiloTestVao');
        vao.getVertexCount().should.equal(0);
    });
});