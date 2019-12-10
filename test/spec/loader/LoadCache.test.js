const LoadCache = Hilo3d.LoadCache;

describe('LoadCache', () => {
    it('create', () => {
        const cache = new LoadCache;
        cache.isLoadCache.should.be.true();
        cache.className.should.equal('LoadCache');
    });
});