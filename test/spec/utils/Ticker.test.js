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
        let startTime;
        ticker.addTick({
            tick:function(){
                if(!startTime){
                    startTime = Date.now();
                }
                else{
                    try{
                        (Date.now() - startTime).should.be.within(11, 21);
                        done();
                    }
                    catch(e){
                        done(e);
                    }
                }
            }
        });
        ticker.start(false);
    });
});