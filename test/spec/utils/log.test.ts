import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const log = Hilo3d.log;

let logStub: Mock<Console['log']>;
let warnStub: Mock<Console['warn']>;
let errorStub: Mock<Console['error']>;

describe('log', () => {
    beforeEach(() => {
        logStub = vi.fn<Console['log']>();
        errorStub = vi.fn<Console['error']>();
        warnStub = vi.fn<Console['warn']>();

        const testConsole = Object.create(console) as Console;
        testConsole.log = logStub;
        testConsole.warn = warnStub;
        testConsole.error = errorStub;
        log.console = testConsole;
        log.level = log.LEVEL_LOG | log.LEVEL_WARN | log.LEVEL_ERROR;
    });

    afterEach(() => {
        log.console = console;
    });

    it('logOnce', function () {
        log.logOnce('no1');
        expect(logStub).toHaveBeenCalledTimes(1);
        log.logOnce('no1');
        expect(logStub).toHaveBeenCalledTimes(1);
        log.logOnce('no2');
        expect(logStub).toHaveBeenCalledTimes(2);
        log.logOnce('no2');
        expect(logStub).toHaveBeenCalledTimes(2);
    });

    it('warnOnce', function () {
        log.warnOnce('no1');
        expect(warnStub).toHaveBeenCalledTimes(1);
        log.warnOnce('no1');
        expect(warnStub).toHaveBeenCalledTimes(1);
        log.warnOnce('no2');
        expect(warnStub).toHaveBeenCalledTimes(2);
        log.warnOnce('no2');
        expect(warnStub).toHaveBeenCalledTimes(2);
    });

    it('errorOnce', function () {
        log.errorOnce('no1');
        expect(errorStub).toHaveBeenCalledTimes(1);
        log.errorOnce('no1');
        expect(errorStub).toHaveBeenCalledTimes(1);
        log.errorOnce('no2');
        expect(errorStub).toHaveBeenCalledTimes(2);
        log.errorOnce('no2');
        expect(errorStub).toHaveBeenCalledTimes(2);
    });

    it('log level:default', function () {
        log.log();
        expect(logStub).toHaveBeenCalledTimes(1);
        log.warn();
        expect(warnStub).toHaveBeenCalledTimes(1);
        log.error();
        expect(errorStub).toHaveBeenCalledTimes(1);
    });

    it('log level:none', function () {
        log.level = log.LEVEL_NONE;
        log.log();
        expect(logStub).toHaveBeenCalledTimes(0);
        log.warn();
        expect(warnStub).toHaveBeenCalledTimes(0);
        log.error();
        expect(errorStub).toHaveBeenCalledTimes(0);
    });

    it('log level:log', function () {
        log.level = log.LEVEL_LOG;
        log.log();
        expect(logStub).toHaveBeenCalledTimes(1);
        log.warn();
        expect(warnStub).toHaveBeenCalledTimes(0);
        log.error();
        expect(errorStub).toHaveBeenCalledTimes(0);
    });

    it('log level:warn', function () {
        log.level = log.LEVEL_WARN;
        log.log();
        expect(logStub).toHaveBeenCalledTimes(0);
        log.warn();
        expect(warnStub).toHaveBeenCalledTimes(1);
        log.error();
        expect(errorStub).toHaveBeenCalledTimes(0);
    });

    it('log level:error', function () {
        log.level = log.LEVEL_ERROR;
        log.log();
        expect(logStub).toHaveBeenCalledTimes(0);
        log.warn();
        expect(warnStub).toHaveBeenCalledTimes(0);
        log.error();
        expect(errorStub).toHaveBeenCalledTimes(1);
    });

    it('log level:log|warn', function () {
        log.level = log.LEVEL_LOG | log.LEVEL_WARN;
        log.log();
        expect(logStub).toHaveBeenCalledTimes(1);
        log.warn();
        expect(warnStub).toHaveBeenCalledTimes(1);
        log.error();
        expect(errorStub).toHaveBeenCalledTimes(0);
    });

    it('log level:log|error', function () {
        log.level = log.LEVEL_LOG | log.LEVEL_ERROR;
        log.log();
        expect(logStub).toHaveBeenCalledTimes(1);
        log.warn();
        expect(warnStub).toHaveBeenCalledTimes(0);
        log.error();
        expect(errorStub).toHaveBeenCalledTimes(1);
    });

    it('log level:error|warn', function () {
        log.level = log.LEVEL_ERROR | log.LEVEL_WARN;
        log.log();
        expect(logStub).toHaveBeenCalledTimes(0);
        log.warn();
        expect(warnStub).toHaveBeenCalledTimes(1);
        log.error();
        expect(errorStub).toHaveBeenCalledTimes(1);
    });

    it('log level:log|warn|error', function () {
        log.level = log.LEVEL_LOG | log.LEVEL_WARN | log.LEVEL_ERROR;
        log.log();
        expect(logStub).toHaveBeenCalledTimes(1);
        log.warn();
        expect(warnStub).toHaveBeenCalledTimes(1);
        log.error();
        expect(errorStub).toHaveBeenCalledTimes(1);
    });
});
