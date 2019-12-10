const LoadQueue = Hilo3d.LoadQueue;

describe('LoadQueue', () => {
    it('create', () => {
        const queue = new LoadQueue;
        queue.isLoadQueue.should.be.true();
        queue.className.should.equal('LoadQueue');
    });
});