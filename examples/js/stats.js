(function(){
    function Stats(ticker, renderInfo, container) {
        this.renderInfo = renderInfo;
        this.ticker = ticker;
        this.container = container;

        this.createContainer();
        this.start();
    }

    Stats.prototype.createContainer = function() {
        if (this.container) {
            return;
        }
        this.container = document.createElement('div');
        this.container.className = 'hilo3dStats';
        this.container.style.cssText = 'position: absolute;left: 5px;top:5px;color:#000;font-size: 12px;z-index: 999999;';
        document.body.appendChild(this.container);
    };

    Stats.prototype.getFpsInfo = function() {
        return 'fps: ' + this.ticker.getMeasuredFPS();
    };

    Stats.prototype.getFaceCountInfo = function () {
        return 'faceCount: ' + this.renderInfo.faceCount;
    };

    Stats.prototype.getDrawCountInfo = function() {
        return 'drawCount: ' + this.renderInfo.drawCount;
    };

    Stats.prototype.getMemoryInfo = function() {
        var memory = window.performance && performance.memory;
        if (!memory) {
            return 'memory: NaN';
        }
        return 'memory: ' + (memory.usedJSHeapSize / memory.jsHeapSizeLimit * 100).toFixed(2) + '%';
    };

    Stats.prototype.start = function() {
        var that = this;
        setInterval(function() {
            var info = [
                that.getFpsInfo(),
                that.getFaceCountInfo(),
                that.getDrawCountInfo(),
                that.getMemoryInfo()
            ];
            that.container.innerHTML = info.join('<br>');
        }, 1000);
    };

    Stats.prototype.profile = function(name) {
        console.profile(name);
        this.ticker._tick();
        console.profileEnd(name);
    };

    if(typeof module !== 'undefined'){
        module.exports = Stats;
    }

    if(typeof window !== 'undefined'){
        window.Stats = Stats;
    }
})();