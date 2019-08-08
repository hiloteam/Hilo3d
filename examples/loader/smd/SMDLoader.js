(function () {
    var Class = Hilo3d.Class;
    var BasicLoader = Hilo3d.BasicLoader;
    var AnimationStates = Hilo3d.AnimationStates;
    var Animation = Hilo3d.Animation;

    var SMDLoader = Class.create({
        Extends: BasicLoader,
        constructor: function () {
            SMDLoader.superclass.constructor.call(this);
        },
        load: function (params) {
            var that = this;
            return this.loadRes(params.src, 'text')
                .then(function (content) {
                    return that.parse(content);
                }).then(function (result) {
                    var keyTime = result._KeyTime.map(function (t) {
                        return t / 30;
                    });
                    delete result._KeyTime;
                    var animStatesList = [];
                    Object.keys(result).forEach(function (name) {
                        var data = result[name];
                        animStatesList.push(new AnimationStates({
                            nodeName: name,
                            keyTime,
                            states: data.translation,
                            type: AnimationStates.StateType.TRANSLATION
                        }));
                        animStatesList.push(new AnimationStates({
                            nodeName: name,
                            keyTime,
                            states: data.rotation,
                            type: AnimationStates.StateType.ROTATION
                        }));
                    });
                    return new Animation({
                        animStatesList
                    });
                }).catch(function (err) {
                    console.warn('load smd failed', err);
                    throw err;
                });
        },
        parse: function (content) {
            var lines = content.split(/[\n\r]+/);
            var result = {
                _KeyTime: []
            };

            var nodeMap = {};
            var currentType = '';

            lines.forEach(function (line) {
                var parts = line.trim().split(/\s+/);
                if (parts[0] === 'version') {
                    return;
                } else if (line === 'nodes') {
                    currentType = 'node';
                } else if (parts[0] === 'end') {
                    currentType = '';
                } else if (parts[0] === 'time') {
                    currentType = 'time';
                    result._KeyTime.push(Number(parts[1]));
                } else if (currentType === 'node') {
                    nodeMap[parts[0]] = parts[1].slice(1, -1);
                } else if (currentType === 'time') {
                    var id = parts[0];
                    var nodeName = nodeMap[id];
                    var translation = parts.slice(1, 4).map(Number);
                    var rotation = parts.slice(4, 7).map(Number);

                    result[nodeName] = result[nodeName] || {};
                    result[nodeName].translation = result[nodeName].translation || [];
                    result[nodeName].rotation = result[nodeName].rotation || [];
                    result[nodeName].translation.push(translation);
                    result[nodeName].rotation.push(rotation);
                }
            });

            return result;
        }
    });

    Hilo3d.SMDLoader = SMDLoader;
    Hilo3d.Loader.addLoader('smd', SMDLoader);
})();