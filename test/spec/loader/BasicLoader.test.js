const BasicLoader = Hilo3d.BasicLoader;

describe('BasicLoader', () => {
    it('create', () => {
        const loader = new BasicLoader;
        loader.isBasicLoader.should.be.true();
        loader.className.should.equal('BasicLoader');
    });
});