const WebGPUSupport = Hilo3d.WebGPUSupport;

describe('WebGPUSupport', function() {
    describe('isAvailable', function() {
        it('should return a boolean', function() {
            const result = WebGPUSupport.isAvailable();
            result.should.be.type('boolean');
        });

        it('should check for navigator.gpu existence', function() {
            if (typeof navigator !== 'undefined' && navigator.gpu) {
                WebGPUSupport.isAvailable().should.be.true();
            } else {
                WebGPUSupport.isAvailable().should.be.false();
            }
        });
    });

    describe('get', function() {
        it('should return a Promise', function() {
            const result = WebGPUSupport.get();
            result.should.be.instanceof(Promise);
        });

        it('should resolve to a boolean', async function() {
            const result = await WebGPUSupport.get();
            result.should.be.type('boolean');
        });

        it('should return false if WebGPU is not available', async function() {
            if (!WebGPUSupport.isAvailable()) {
                const result = await WebGPUSupport.get();
                result.should.be.false();
            }
        });

        it('should cache the result', async function() {
            const result1 = await WebGPUSupport.get();
            const result2 = await WebGPUSupport.get();
            result1.should.equal(result2);
        });
    });
});
