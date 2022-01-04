const Ticker = Hilo3d.Ticker;

describe('Ticker', function(){
    let ticker, tickObj;
    beforeEach('init Ticker', function(){
        ticker = new Ticker(60);
        tickObj = {
            tickNum:0,
            tick:function(){
                this.tickNum ++;
            }
        };
    });

    afterEach('destroy Ticker', function(){
        ticker.stop();
    });

    it('addTick & removeTick', function(){
        ticker._tick();
        tickObj.tickNum.should.equal(0);

        //addTick
        ticker.addTick(tickObj);
        ticker._tick();
        tickObj.tickNum.should.equal(1);
        ticker._tick();
        tickObj.tickNum.should.equal(2);

        //removeTick
        ticker.removeTick(tickObj);
        ticker._tick();
        tickObj.tickNum.should.equal(2);
    });

    it('tick time', function(done){
        if (window._IS_CI) {
            done();
            return;
        }
        ticker.start();
        setTimeout(() => {
            let startTime;
            ticker.addTick({
                tick:(dt) => {
                    if (!startTime) {
                        startTime = Date.now();
                    } else {
                        (Date.now() - startTime).should.be.within(13, 20);
                        done();
                    }
                }
            });
        }, 300);
    });

    it('pause & resume', function(done){
        if (window._IS_CI) {
            done();
            return;
        }
        ticker.addTick(tickObj);
        ticker.start();
        let tickNum;
        setTimeout(() => {
            tickObj.tickNum.should.above(1);
            tickNum = tickObj.tickNum;
            ticker.pause();
            setTimeout(() => {
                tickObj.tickNum.should.equal(tickNum);
                ticker.resume();
                setTimeout(() => {
                    tickObj.tickNum.should.above(tickNum + 1);
                    done();
                }, 300);
            }, 300);
        }, 300);
    });

    it('targetFPS', function(done) {
        if (window._IS_CI) {
            done();
            return;
        }
        ticker.start();

        ticker.targetFPS = 30;
        ticker._useRAF.should.be.false();
        setTimeout(() => {
            ticker.nextTick((dt) => {
                dt.should.be.within(30, 37);
                ticker.targetFPS = 60;
                ticker._useRAF.should.be.true();
                setTimeout(() => {
                   ticker.nextTick((dt) => {
                       dt.should.be.within(13, 20);
                       done();
                   });
               }, 300);
            });
        }, 300);
    });
});