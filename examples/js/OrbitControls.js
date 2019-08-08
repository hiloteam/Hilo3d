(function () {
    var PI2 = Math.PI / 2;
    var tempEuler = new Hilo3d.Euler();
    tempEuler.order = 'XYZ';
    var tempQuat = new Hilo3d.Quaternion();
    var tempMatrix = new Hilo3d.Matrix4();
    var tempVector = new Hilo3d.Vector3();
    var MOUSE = {
        LEFT: 0,
        MID: 1,
        RIGHT: 2
    };
    var STATE = {
        NONE: -1,
        MOVE: 0,
        ZOOM: 1,
        PAN: 2
    }

    function OrbitControls(stage, opt) {
        if (opt instanceof Hilo3d.Node) {
            opt = {
                model: opt
            };
        } else if (!opt) {
            opt = {};
        }
        this.model = opt.model || stage;
        this.stage = stage;
        this.canvas = stage.canvas;
        this.isLockZ = !!opt.isLockZ;
        this.rotationXLimit = opt.rotationXLimit;
        this.isLockScale = !!opt.isLockScale;
        this.isLockRotate = !!opt.isLockRotate;
        this.isLockMove = !!opt.isLockMove;
        if (opt.eulerOrder) {
            tempEuler.order = opt.eulerOrder;
        }

        if (this.isLockZ) {
            tempEuler.x = this.model.rotationX * Math.PI / 180;
            tempEuler.y = this.model.rotationY * Math.PI / 180;
        }

        this.mouseInfo = {
            startX: 0,
            startY: 0,
            isDown: false
        };

        this.onWheel = this.onWheel.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);

        this.isEnabled = false;
        this.enable();
    }

    OrbitControls.prototype.enable = function(){
        if(!this.isEnabled){
            this.isEnabled = true;
            var canvas = this.canvas;
            canvas.addEventListener('wheel', this.onWheel, false);

            if ('ontouchmove' in window) {
                canvas.addEventListener('touchstart', this.onMouseDown, false);
                canvas.addEventListener('touchmove', this.onMouseMove, false);
                canvas.addEventListener('touchend', this.onMouseUp, false);
            } else {
                document.addEventListener('contextmenu', function (evt) {
                    //禁掉鼠标右键菜单
                    evt.preventDefault()
                });
                canvas.addEventListener('mousedown', this.onMouseDown, false);
                canvas.addEventListener('mousemove', this.onMouseMove, false);
                canvas.addEventListener('mouseup', this.onMouseUp, false);
            }
        }
    };

    OrbitControls.prototype.disable = function(){
        if(this.isEnabled){
            this.isEnabled = false;
            this.mouseInfo.isDown = false;
            this.mouseInfo.state = STATE.NONE;

            var canvas = this.canvas;
            canvas.removeEventListener('wheel', this.onWheel, false);

            if ('ontouchmove' in window) {
                canvas.removeEventListener('touchstart', this.onMouseDown, false);
                canvas.removeEventListener('touchmove', this.onMouseMove, false);
                canvas.removeEventListener('touchend', this.onMouseUp, false);
            } else {
                document.removeEventListener('contextmenu', function (evt) {
                    //禁掉鼠标右键菜单
                    evt.preventDefault()
                });
                canvas.removeEventListener('mousedown', this.onMouseDown, false);
                canvas.removeEventListener('mousemove', this.onMouseMove, false);
                canvas.removeEventListener('mouseup', this.onMouseUp, false);
            }
        }
    }

    OrbitControls.prototype.rotate = function(distanceX, distanceY) {
        if (this.isLockRotate) {
            return;
        }
        var x = distanceY / 200;
        var y = distanceX / 200;
        if (this.isLockZ) {
            tempEuler.x += x;
            tempEuler.y += y;
            if (this.rotationXLimit) {
                if (tempEuler.x > this.rotationXLimit) {
                    tempEuler.x = this.rotationXLimit;
                } else if (tempEuler.x < -this.rotationXLimit) {
                    tempEuler.x = -this.rotationXLimit;
                }
            }
            this.model.quaternion.fromEuler(tempEuler);
        } else {
            tempEuler.set(x, y, 0);
            tempQuat.fromEuler(tempEuler);
            this.model.quaternion.premultiply(tempQuat);
        }
    };

    OrbitControls.prototype.scale = function(s) {
        if (this.isLockScale) {
            return;
        }
        this.model.scaleX *= s;
        this.model.scaleY *= s;
        this.model.scaleZ *= s;

        this.onScale && this.onScale(s);
    };

    OrbitControls.prototype.move = function(x, y) {
        if(this.isLockMove){
            return;
        }
        this.model.x += x;
        this.model.y += y;
    };

    OrbitControls.prototype.onMouseDown = function (evt) {
        this.mouseInfo.isDown = true;
        if (evt.type === 'touchstart') {

            this.mouseInfo.startX = evt.touches[0].pageX;
            this.mouseInfo.startY = evt.touches[0].pageY;

            switch (evt.touches.length) {
                case 1:
                    this.mouseInfo.state = STATE.MOVE;
                    break;
                case 2:
                    var x = evt.touches[1].pageX - evt.touches[0].pageX;
                    var y = evt.touches[1].pageY - evt.touches[0].pageY;
                    this.mouseInfo.startPointerDistance = Math.sqrt(x * x + y * y);
                    this.mouseInfo.state = STATE.ZOOM;
                    break;
                case 3:
                    this.mouseInfo.state = STATE.PAN;
                    break;
            }
        } else {
            switch (evt.button) {
                case MOUSE.LEFT:
                    this.mouseInfo.startX = evt.pageX;
                    this.mouseInfo.startY = evt.pageY;
                    this.mouseInfo.state = STATE.MOVE;
                    break;
                case MOUSE.RIGHT:
                    this.mouseInfo.startX = evt.pageX;
                    this.mouseInfo.startY = evt.pageY;
                    this.mouseInfo.state = STATE.PAN;
                    break;
            }
        }
    }

    OrbitControls.prototype.onMouseMove = function (evt) {
        if (!this.mouseInfo.isDown) {
            return;
        }
        evt.preventDefault();
        evt.stopPropagation();
        var scope = this;
        if (evt.type === 'touchmove') {
            switch (this.mouseInfo.state) {
                case STATE.MOVE:
                    scope.handlerToucheMove(evt);
                    break;
                case STATE.ZOOM:
                    scope.handlerToucheZoom(evt);
                    break;
                case STATE.PAN:
                    scope.handlerTouchePan(evt);
                    break;
            }
        } else {
            switch (this.mouseInfo.state) {
                case STATE.MOVE:
                    scope.handlerMouseMove(evt);
                    break;
                case STATE.PAN:
                    scope.handlerMousePan(evt);
                    break;
            }
        }

    }

    OrbitControls.prototype.handlerMousePan = function (evt) {
        var distanceX = evt.pageX - this.mouseInfo.startX;
        var distanceY = evt.pageY - this.mouseInfo.startY;
        this.mouseInfo.startX = evt.pageX;
        this.mouseInfo.startY = evt.pageY;
        this.model.worldMatrix.getScaling(tempVector);
        this.move(distanceX * 2 * tempVector.x, distanceY * 2 * tempVector.y);
    }

    OrbitControls.prototype.handlerMouseMove = function (evt) {
        var distanceX = evt.pageX - this.mouseInfo.startX;
        var distanceY = evt.pageY - this.mouseInfo.startY;
        this.mouseInfo.startX = evt.pageX;
        this.mouseInfo.startY = evt.pageY;

        this.rotate(distanceX, distanceY);
    }

    OrbitControls.prototype.handlerToucheZoom = function (evt) {
        var x = evt.touches[1].pageX - evt.touches[0].pageX;
        var y = evt.touches[1].pageY - evt.touches[0].pageY;
        var pointerDistance = Math.sqrt(x * x + y * y);
        var scale = 1
        scale = pointerDistance / this.mouseInfo.startPointerDistance;
        this.mouseInfo.startPointerDistance = pointerDistance;
        if (scale != 1) {
            this.scale(scale);
        }
    }

    OrbitControls.prototype.handlerTouchePan = function (evt) {
        evt = evt.touches[0];
        var distanceX = evt.pageX - this.mouseInfo.startX;
        var distanceY = evt.pageY - this.mouseInfo.startY;
        this.mouseInfo.startX = evt.pageX;
        this.mouseInfo.startY = evt.pageY;
        this.move(distanceX * .01, -distanceY * .01);
    }

    OrbitControls.prototype.handlerToucheMove = function (evt) {
        var model = this.model;
        evt = evt.touches[0];
        this.handlerMouseMove(evt);
    }

    OrbitControls.prototype.onMouseUp = function (evt) {
        this.mouseInfo.isDown = false;
        this.mouseInfo.state = STATE.NONE;
    }

    OrbitControls.prototype.onWheel = function (evt) {
        evt.preventDefault();
        var _deltaY = evt.deltaY;
        if (_deltaY < -100) {
            _deltaY = -90
        } else if (_deltaY > 100) {
            _deltaY = 90
        }
        var s = 1 + _deltaY * 0.001;
        this.scale(1 / s);
    }

    OrbitControls.prototype.bindEvent = function () {
        
    }

    if(typeof module !== 'undefined'){
        module.exports = OrbitControls;
    }

    if(typeof window !== 'undefined'){
        window.OrbitControls = OrbitControls;
    }
})();