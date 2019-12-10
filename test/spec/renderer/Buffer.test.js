const Buffer = Hilo3d.Buffer;

describe('Buffer', () => {
    it('create', () => {
        const buffer = new Buffer(testEnv.gl);
        buffer.isBuffer.should.be.true();
        buffer.className.should.equal('Buffer');
    });

    it('cache & destroy', () => {
        const buffer = Buffer.createVertexBuffer(testEnv.gl, new Hilo3d.GeometryData());
        Buffer.cache.getObject(buffer).should.equal(buffer);
        buffer.destroy();
        should(Buffer.cache.getObject(buffer)).be.undefined();
    });
});