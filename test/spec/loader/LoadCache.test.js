const LoadCache = Hilo3d.LoadCache;

describe('LoadCache', () => {
    let cache;
    beforeEach('init eventTarget', function(){
        cache = new LoadCache();
    });
    it('create', () => {
        cache.isLoadCache.should.be.true();
        cache.className.should.equal('LoadCache');
    });

    it('update', () => {
        const callbackAll = sinon.spy();
        const callbackA = sinon.spy();
        const callbackB = sinon.spy();
        cache.on('update', callbackAll);
        cache.on('update:a', callbackA);
        cache.on('update:b', callbackB);
        
        cache.update('a', LoadCache.LOADED, 1);

        callbackAll.should.have.callCount(1);
        callbackAll.lastCall.args[0].detail.should.deepEqual({
            key: 'a',
            state: LoadCache.LOADED,
            data: 1
        });

        callbackA.should.have.callCount(1);
        callbackA.lastCall.args[0].detail.should.deepEqual({
            key: 'a',
            state: LoadCache.LOADED,
            data: 1
        });

        callbackB.should.have.callCount(0);
        
        cache.update('b', LoadCache.PENDING, 2);

        callbackAll.should.have.callCount(2);
        callbackAll.lastCall.args[0].detail.should.deepEqual({
            key: 'b',
            state: LoadCache.PENDING,
            data: 2
        });
        callbackA.should.have.callCount(1);
        callbackB.should.have.callCount(1);
        callbackB.lastCall.args[0].detail.should.deepEqual({
            key: 'b',
            state: LoadCache.PENDING,
            data: 2
        });
    });

    it('get', () => {
        cache.update('a', LoadCache.LOADED, 1);
        cache.update('b', LoadCache.PENDING, 2);

        cache.get('a').should.deepEqual({
            key: 'a',
            state: LoadCache.LOADED,
            data: 1
        });

        cache.get('b').should.deepEqual({
            key: 'b',
            state: LoadCache.PENDING,
            data: 2
        });

        should.not.exist(cache.get('c'));
    });

    it('enabled', () => {
        cache.enabled = false;

        const callbackAll = sinon.spy();
        const callbackA = sinon.spy();
        cache.on('update', callbackAll);
        cache.on('update:a', callbackA);
        
        cache.update('a', LoadCache.LOADED, 1);
        callbackAll.should.have.callCount(0);
        callbackA.should.have.callCount(0);

        should.not.exist(cache.get('a'));
    });

    it('getLoaded', () => {
        cache.update('a', LoadCache.LOADED, 1);
        cache.update('b', LoadCache.LOADED, 2);
        cache.update('c', LoadCache.PENDING, 3);
        cache.update('d', LoadCache.FAILED, 4);

        cache.getLoaded('a').should.equal(1);
        cache.getLoaded('b').should.equal(2);
        should(cache.getLoaded('c')).be.null();
        should(cache.getLoaded('d')).be.null();
        should(cache.getLoaded('e')).be.null();
    });

    it('remove', () => {
        cache.update('a', LoadCache.LOADED, 1);
        should.exist(cache.get('a'));
        cache.remove('a');
        should.not.exist(cache.get('a'));
    });

    it('clear', () => {
        cache.update('a', LoadCache.LOADED, 1);
        cache.update('b', LoadCache.LOADED, 1);
        should.exist(cache.get('a'));
        should.exist(cache.get('b'));
        cache.clear();
        should.not.exist(cache.get('a'));
        should.not.exist(cache.get('b'));
    });

    it('wait', (done) => {
        const resolveA0 = sinon.spy();
        const rejectA0 = sinon.spy();
        const resolveA1 = sinon.spy();
        const rejectA1 = sinon.spy();

        const resolveB0 = sinon.spy();
        const rejectB0 = sinon.spy();
        const resolveB1 = sinon.spy();
        const rejectB1 = sinon.spy();

        const resolveC = sinon.spy();
        const rejectC = sinon.spy();
        
        cache.update('a', LoadCache.PENDING);
        cache.wait(cache.get('a')).then(resolveA0, rejectA0);
        cache.update('a', LoadCache.LOADED, 1);
        cache.wait(cache.get('a')).then(resolveA1, rejectA1);

        cache.update('b', LoadCache.PENDING, 2);
        cache.wait(cache.get('b')).then(resolveB0, rejectB0);
        cache.update('b', LoadCache.FAILED);
        cache.wait(cache.get('b')).then(resolveB1, rejectB1);

        cache.wait(cache.get('c')).then(resolveC, rejectC);

        Promise.resolve().then(() => {
            resolveA0.should.callCount(1);
            resolveA0.lastCall.args[0].should.equal(1);
            rejectA0.should.callCount(0);

            resolveA1.should.callCount(1);
            resolveA1.lastCall.args[0].should.equal(1);
            rejectA1.should.callCount(0);

            resolveB0.should.callCount(0);
            rejectB0.should.callCount(1);

            resolveB1.should.callCount(0);
            rejectB1.should.callCount(1);

            resolveC.should.callCount(0);
            rejectC.should.callCount(1);

            done();
        });
    });
});