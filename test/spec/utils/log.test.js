const log = Hilo3d.log;

let logStub, warnStub, errorStub;

describe('log', function() {
    beforeEach('init log', function() {
        logStub = sinon.stub();
        errorStub = sinon.stub();
        warnStub = sinon.stub();

        log.console = {
            log: logStub,
            warn: warnStub,
            error: errorStub
        };
    });

    afterEach('remove log', function() {
        logStub = null;
        warnStub = null;
        errorStub = null;

        log.console = console;
    });

    it('logOnce', function() {
        log.logOnce('no1');
        logStub.should.have.callCount(1);
        log.logOnce('no1');
        logStub.should.have.callCount(1);
        log.logOnce('no2');
        logStub.should.have.callCount(2);
        log.logOnce('no2');
        logStub.should.have.callCount(2);
    });

    it('warnOnce', function() {
        log.warnOnce('no1');
        warnStub.should.have.callCount(1);
        log.warnOnce('no1');
        warnStub.should.have.callCount(1);
        log.warnOnce('no2');
        warnStub.should.have.callCount(2);
        log.warnOnce('no2');
        warnStub.should.have.callCount(2);
    });

    it('errorOnce', function() {
        log.errorOnce('no1');
        errorStub.should.have.callCount(1);
        log.errorOnce('no1');
        errorStub.should.have.callCount(1);
        log.errorOnce('no2');
        errorStub.should.have.callCount(2);
        log.errorOnce('no2');
        errorStub.should.have.callCount(2);
    });

    it('log level:default', function() {
        log.log();
        logStub.should.have.callCount(1);
        log.warn();
        warnStub.should.have.callCount(1);
        log.error();
        errorStub.should.have.callCount(1);
    });

    it('log level:none', function() {
        log.level = log.LEVEL_NONE;
        log.log();
        logStub.should.have.callCount(0);
        log.warn();
        warnStub.should.have.callCount(0);
        log.error();
        errorStub.should.have.callCount(0);
    });

    it('log level:log', function() {
        log.level = log.LEVEL_LOG;
        log.log();
        logStub.should.have.callCount(1);
        log.warn();
        warnStub.should.have.callCount(0);
        log.error();
        errorStub.should.have.callCount(0);
    });

    it('log level:warn', function() {
        log.level = log.LEVEL_WARN;
        log.log();
        logStub.should.have.callCount(0);
        log.warn();
        warnStub.should.have.callCount(1);
        log.error();
        errorStub.should.have.callCount(0);
    });

    it('log level:error', function() {
        log.level = log.LEVEL_ERROR;
        log.log();
        logStub.should.have.callCount(0);
        log.warn();
        warnStub.should.have.callCount(0);
        log.error();
        errorStub.should.have.callCount(1);
    });

    it('log level:log|warn', function() {
        log.level = log.LEVEL_LOG | log.LEVEL_WARN;
        log.log();
        logStub.should.have.callCount(1);
        log.warn();
        warnStub.should.have.callCount(1);
        log.error();
        errorStub.should.have.callCount(0);
    });

    it('log level:log|error', function() {
        log.level = log.LEVEL_LOG | log.LEVEL_ERROR;
        log.log();
        logStub.should.have.callCount(1);
        log.warn();
        warnStub.should.have.callCount(0);
        log.error();
        errorStub.should.have.callCount(1);
    });

    it('log level:error|warn', function() {
        log.level = log.LEVEL_ERROR | log.LEVEL_WARN;
        log.log();
        logStub.should.have.callCount(0);
        log.warn();
        warnStub.should.have.callCount(1);
        log.error();
        errorStub.should.have.callCount(1);
    });

    it('log level:log|warn|error', function() {
        log.level = log.LEVEL_LOG | log.LEVEL_WARN | log.LEVEL_ERROR;
        log.log();
        logStub.should.have.callCount(1);
        log.warn();
        warnStub.should.have.callCount(1);
        log.error();
        errorStub.should.have.callCount(1);
    });
});