(function () {
    var Class = Hilo3d.Class;
    var BasicLoader = Hilo3d.BasicLoader;
    var Node = Hilo3d.Node;
    var BasicMaterial = Hilo3d.BasicMaterial;
    var Geometry = Hilo3d.Geometry;
    var GeometryData = Hilo3d.GeometryData;
    var Mesh = Hilo3d.Mesh;
    var util = Hilo3d.util;
    var Matrix4 = Hilo3d.Matrix4;

    var ATTR_ENUM = {
        Vertex: 1,
        Normal: 2,
        TexCoord: 4,
        Color: 8,
        Triangle: 16,
        Tangent: 32
    };
    var V = {
        quantization: 1,
        prediction: 2,
        delta: 4
    };
    var _ = {
        delta: 1,
        highWatermark: 2,
        implicit: 4
    };

    var IMPLICIT_HEADER = {
        PRIMITIVE_LENGTH: 0,
        MASK_LENGTH: 1,
        EXPECTED_INDEX: 2,
        LENGTH: 3,
    };

    var sphereCoordCache = {};

    var OSGLoader = Class.create({
        Extends: BasicLoader,
        constructor: function () {
            OSGLoader.superclass.constructor.call(this);
        },
        getMaterial: function (data, materialInfo) {
            var material;
            if (!materialInfo) {
                material = new BasicMaterial();
                if (!data.StateSet) {
                    return material;
                }
                if (!data.StateSet['osg.StateSet'].AttributeList) {
                    return material;
                }
                var values = data.StateSet['osg.StateSet'].AttributeList[0]['osg.Material'];
                material.name = values.Name;
                if (values.Diffuse) {
                    material.diffuse.fromArray(values.Diffuse);
                }
                if (values.Emission) {
                    material.emission.fromArray(values.Emission);
                }
                if (values.Shininess) {
                    material.shininess = values.Shininess;
                }
                if (values.Specular) {
                    material.specular.fromArray(values.Specular);
                }
            } else {
                if (materialInfo.material) {
                    return materialInfo.material;
                }
                if (materialInfo.isPBR) {
                    material = new Hilo3d.PBRMaterial();
                    // material.transparent = true;
                    // material.transparency = new Hilo3d.LazyTexture({
                    //     flipY: true,
                    //     src: materialInfo.transparency.texture.image
                    // });
                    material.baseColorMap = new Hilo3d.LazyTexture({
                        flipY: true,
                        src: materialInfo.diffuse.texture.image
                    });
                    // material.normalMap = new Hilo3d.LazyTexture({
                    //     flipY: true,
                    //     src: materialInfo.normalMap.texture.image
                    // });
                    material.isSpecularGlossiness = true;
                    material.specularGlossinessMap = new Hilo3d.LazyTexture({
                        flipY: true,
                        src: materialInfo.specular.texture.image
                    });
                    materialInfo.material = material;
                }
            }

            return material;
        },
        decodeForDelta(data, start) {
            start = start || 0;
            var len = data.length;
            var prev = data[start];
            for (var i = start + 1; i < len; i++) {
                var d = data[i];
                data[i] = prev + (d >> 1 ^ -(1 & d));
                prev = data[i];
            }
        },
        decodeForImplicit: function(data, newData, start, highWatermark) {
            // for (var a = e[r.IMPLICIT_HEADER_EXPECTED_INDEX], o = e[r.IMPLICIT_HEADER_MASK_LENGTH], s = new Uint32Array(e.subarray(r.IMPLICIT_HEADER_LENGTH, o + r.IMPLICIT_HEADER_LENGTH)), u = 32 * o - t.length, l = 0; l < o; ++l)
            //     for (var c = s[l], h = 32 * l, d = l === o - 1 ? u : 0, p = d; p < 32; ++p,
            //         ++h)
            //         t[h] = c & 1 << 31 >>> p ? e[i++] : n ? a : a++;
            // return t
            var a = data[IMPLICIT_HEADER.EXPECTED_INDEX];
            var o = data[IMPLICIT_HEADER.MASK_LENGTH];
            var s = new Uint32Array(data.subarray(IMPLICIT_HEADER.LENGTH, o + IMPLICIT_HEADER.LENGTH));
            var u = 32 * o - newData.length;
            for (var l = 0; l < o; ++l) {
                var c = s[l];
                var h = 32 * l;
                var d = l === o - 1 ? u : 0;

                for (var p = d; p < 32; ++p,++h) {
                    newData[h] = c & 1 << 31 >>> p ? data[start++] : highWatermark ? a : a++;
                }
            }
        },
        decodeForHighWatermark: function (data, newData, i) {
            var len = data.length;
            for (var r = i[0], a = 0; a < len; ++a) {
                var o = r - data[a];
                newData[a] = o;
                if (r <= o) {
                    r = o + 1;
                }
            }
            i[0] = r;
        },
        decodeVarint(sourceData, TypedArray, count) {
            var data = new TypedArray(count);
            var isSigned = TypedArray.name[0] !== 'U';
            var j = -1;
            for (var i = 0; i < count; i++) {
                var d = 0;
                var k = 0;
                do {
                    j++;
                    d |= (sourceData[j] & 0x7f) << k;
                    k += 7;
                } while(sourceData[j] & 0x80);
                if (isSigned) {
                    d = d >> 1 ^ -(1 & d);
                }
                data[i] = d;
            }
            // console.log('source data length:', j + 1);
            return data;
        },
        decodeNormal(data, newData, itemSize, epsilon, nphi, isSourceThree) {
            // 球坐标转换 e, t       i           a       o       s
            // isSourceThree 原数据是否为3元素，默认为2元素()
            epsilon = epsilon || .25;
            nphi = nphi || 720;

            var u = Math.cos(.01745329251 * epsilon);
            var l = 0;
            var table = sphereCoordCache.table;
            if (void 0 === table){
                table = sphereCoordCache.table = new Float32Array(1801779)
                for (l = 0; l < 1801779; ++l) {
                    table[l] = 1 / 0;
                }
            }
            var rad = Math.PI / (nphi - 1);
            var d = 1.57079632679 / (nphi - 1);
            var sourceItemSize = isSourceThree ? 3 : 2;
            var sourceItemCount = data.length / sourceItemSize;
            for (l = 0; l < sourceItemCount; ++l) {
                var destIdx = l * itemSize;
                var sourceIdx = l * sourceItemSize;
                var theta = data[sourceIdx];
                var phi = data[sourceIdx + 1];

                if (itemSize === 4 && !isSourceThree) {
                    newData[destIdx + 3] = 1024 & theta ? -1 : 1;
                    theta &= -1025;
                }

                var b, x, S, cacheKey = 3 * (theta + nphi * phi);
                var isOut = cacheKey >= 1801779;
                if (isOut || table[cacheKey] === 1 / 0) {
                    var thetaRad = theta * rad;
                    var cosTheta = Math.cos(thetaRad);
                    var sinTheta = Math.sin(thetaRad);
                    thetaRad += d;

                    var A = (u - cosTheta * Math.cos(thetaRad)) / Math.max(1e-5, sinTheta * Math.sin(thetaRad));
                    if (A > 1) {
                        A = 1;
                    } else if (A < -1) {
                        A = -1;
                    }
                    var E = 6.28318530718 * phi / Math.ceil(Math.PI / Math.max(1e-5, Math.acos(A)));
                    b = sinTheta * Math.cos(E);
                    x = sinTheta * Math.sin(E);
                    S = cosTheta;
                    if (!isOut) {
                        table[cacheKey] = b;
                        table[cacheKey + 1] = x;
                        table[cacheKey + 2] = S;
                    }
                } else {
                    b = table[cacheKey];
                    x = table[cacheKey + 1];
                    S = table[cacheKey + 2];
                }
                if (isSourceThree) {
                    var P = 47938362584151635e-21 * data[sourceIdx + 2];
                    var N = Math.sin(P);
                    newData[destIdx] = N * b;
                    newData[destIdx + 1] = N * x;
                    newData[destIdx + 2] = N * S;
                    newData[destIdx + 3] = Math.cos(P);
                } else {
                    newData[destIdx] = b;
                    newData[destIdx + 1] = x;
                    newData[destIdx + 2] = S
                }
            }
        },
        decodeFloatData1(data, itemSize, indices) {
            //            e       t         i
            var count = data.length / itemSize;
            var map = new Uint8Array(count);
            var lastIndex = indices.length - 1;
            // first face
            map[indices[0]] = 1;
            map[indices[1]] = 1;
            map[indices[2]] = 1;

            for (var o = 2; o < lastIndex; ++o) {
                var s = o - 2;
                var u = indices[s];
                var l = indices[s + 1];
                var c = indices[s + 2];
                var h = indices[s + 3];
                if (1 !== map[h]) {
                    map[h] = 1;
                    u *= itemSize;
                    l *= itemSize;
                    c *= itemSize;
                    h *= itemSize;
                    for (var d = 0; d < itemSize; ++d) {
                        data[h + d] = data[h + d] + data[l + d] + data[c + d] - data[u + d];
                    }
                }
            }
        },
        decodeFloatData2(mode, data, itemSize, name, decodeControl) {
            //              e,   t,     r,      n,      a
            var namePrefix = "POSITION" === name ? "vtx_" : "uv_0_";
            var needDecode = mode & V.quantization && void 0 !== decodeControl[namePrefix + "bbl_x"];
            var isDataFloat32 = data instanceof Float32Array;
            if (!needDecode && isDataFloat32) {
                return data;
            }
            var newData;
            if (data.BYTES_PER_ELEMENT === 4) {
                newData = new Float32Array(data.buffer, data.byteOffset, data.length);
            } else {
                newData = new Float32Array(data.length);
            }
            if (needDecode) {
                var S = [];
                var y = [];
                S[0] = decodeControl[namePrefix + "bbl_x"];
                S[1] = decodeControl[namePrefix + "bbl_y"];
                y[0] = decodeControl[namePrefix + "h_x"];
                y[1] = decodeControl[namePrefix + "h_y"];
                if (itemSize === 3) {
                    S[2] = decodeControl[namePrefix + "bbl_z"];
                    y[2] = decodeControl[namePrefix + "h_z"];
                }
                // i.i(c.a)(t, l, S, y, r);
                // e, t, i, r, n
                for (var a = data.length / itemSize, o = 0; o < a; ++o) {
                    for (var s = o * itemSize, u = 0; u < itemSize; ++u){
                        newData[s + u] = S[u] + data[s + u] * y[u];
                    }
                }
            }
            return newData;
        },
        decodeGeometryData(attrName, info, buffers, decodeControl, indices) {
            this.geometryDataMap = this.geometryDataMap || {};
            if (this.geometryDataMap[info.UniqueID]) {
                return this.geometryDataMap[info.UniqueID];
            }

            var arrayInfo = info.Array;
            var TypedArray = Float32Array;
            if (arrayInfo.Uint32Array) {
                arrayInfo = arrayInfo.Uint32Array;
                TypedArray = Uint32Array;
            } else if (arrayInfo.Int32Array) {
                arrayInfo = arrayInfo.Int32Array;
                TypedArray = Int32Array;
            } else if (arrayInfo.Float32Array) {
                arrayInfo = arrayInfo.Float32Array;
            } else if (arrayInfo.Uint16Array) {
                arrayInfo = arrayInfo.Uint16Array;
                TypedArray = Uint16Array;
            } else {
                console.warn('cant resolve', info.Array);
            }

            var buffer = buffers[arrayInfo.File];

            var result;
            if (!arrayInfo.Encoding) {
                var data = new TypedArray(buffer, arrayInfo.Offset, arrayInfo.Size * info.ItemSize);
                result = new GeometryData(data, info.ItemSize);
            } else {
                // decompression data
                var count = arrayInfo.Size * info.ItemSize;
                var sourceData = new Uint8Array(buffer, arrayInfo.Offset);
                var data = this.decodeVarint(sourceData, TypedArray, count);

                var isTriangleStrip = decodeControl.__mode === 5;
                var triangleMode = Number(decodeControl.triangle_mode);
                if (attrName === 'INDICES') {
                    var start = 0;
                    var newData = data;
                    if (triangleMode & _.implicit && isTriangleStrip) {
                        start = IMPLICIT_HEADER.LENGTH + data[IMPLICIT_HEADER.MASK_LENGTH];
                        newData = new Uint16Array(data[IMPLICIT_HEADER.PRIMITIVE_LENGTH]);
                    }
                    if (triangleMode & _.delta) {
                        this.decodeForDelta(data, start);
                    }
                    if (triangleMode & _.implicit && isTriangleStrip) {
                        this.decodeForImplicit(data, newData, start, triangleMode & _.highWatermark);
                    }
                    if (triangleMode & _.highWatermark) {
                        this.decodeForHighWatermark(newData, newData, decodeControl.__xx);
                    }
                    data = newData;
                } else if (attrName === 'NORMAL' || attrName === 'TANGENT') {
                    var newData = new Float32Array(arrayInfo.Size * 3);
                    this.decodeNormal(data, newData, 3, decodeControl.epsilon, decodeControl.nphi);
                    data = newData;
                } else if (attrName === 'POSITION') {
                    var mode = decodeControl.uv_0_mode || decodeControl.vertex_mode;
                    if (mode & V.prediction) {
                        this.decodeFloatData1(data, 3, indices);
                        data = this.decodeFloatData2(mode, data, 3, attrName, decodeControl);
                    }
                } else if (attrName === 'UV') {
                    var mode = decodeControl.uv_0_mode || decodeControl.vertex_mode;
                    if (mode & V.prediction) {
                        this.decodeFloatData1(data, 2, indices);
                        data = this.decodeFloatData2(mode, data, 2, attrName, decodeControl);
                    }
                }

                result = new GeometryData(data, info.ItemSize);
            }
            this.geometryDataMap[info.UniqueID] = result;
            return result;
        },
        parseUserDataContainer: function(data) {
            var result = {};
            if (data && data.Values) {
                data.Values.forEach(d => {
                    if (/^-?[\.0-9]+$/.test(d.Value)) {
                        d.Value = Number(d.Value);
                    }
                    result[d.Name] = d.Value;
                });
            }
            return result;
        },
        parseGeometry: function (parent, data, buffers, materialInfo) {
            var that = this;
            var material = this.getMaterial(data, materialInfo);
            var userData = this.parseUserDataContainer(data.UserDataContainer) || {};
            var attr = data.VertexAttributeList;
            userData.__xx = [0];
            util.each(data.PrimitiveSetList, function (set) {
                var drawInfo = set.DrawElementsUShort || set.DrawElementsUInt;
                if (!drawInfo) {
                    console.log('has no drawInfo', set);
                    return;
                }
                var geometry = new Geometry();
                geometry.mode = Hilo3d.constants[drawInfo.Mode];
                userData.__mode = geometry.mode;
                geometry.indices = that.decodeGeometryData('INDICES', drawInfo.Indices, buffers, userData);
                var indices = geometry.indices.data;
                if (attr.Normal) {
                    geometry.normals = that.decodeGeometryData('NORMAL', attr.Normal, buffers, userData, indices);
                }
                if (attr.Vertex) {
                    geometry.vertices = that.decodeGeometryData('POSITION', attr.Vertex, buffers, userData, indices);
                }
                if (attr.TexCoord0) {
                    geometry.uvs = that.decodeGeometryData('UV', attr.TexCoord0, buffers, userData, indices);
                }
                if (geometry.mode < 4) {
                    return;
                }

                var mesh = new Mesh({
                    geometry,
                    material
                });
                parent.addChild(mesh);
            });
        },
        parseNode: function (parent, data, buffers, materialsInfo) {
            var that = this;
            var node = new Node({
                name: data.Name
            });

            if (data.Matrix) {
                var mat = new Matrix4();
                mat.fromArray(data.Matrix);
                node.matrix = mat;
            }

            if (data.Children) {
                util.each(data.Children, function (c) {
                    if (c['osg.Node']) {
                        that.parseNode(node, c['osg.Node'], buffers, materialsInfo);
                    } else if (c['osg.MatrixTransform']) {
                        that.parseNode(node, c['osg.MatrixTransform'], buffers, materialsInfo);
                    } else if (c['osg.Geometry']) {
                        var materialInfo = materialsInfo.RootNode;
                        that.parseGeometry(node, c['osg.Geometry'], buffers, materialInfo);
                    }
                });
            }
            parent.addChild(node);
        },
        getBinFilesList: function(data, list) {
            var that = this;
            list = list || {};
            if (data.Children) {
                util.each(data.Children, function (c) {
                    if (c['osg.Node']) {
                        that.getBinFilesList(c['osg.Node'], list);
                    } else if (c['osg.MatrixTransform']) {
                        that.getBinFilesList(c['osg.MatrixTransform'], list);
                    } else if (c['osg.Geometry']) {
                        var g = c['osg.Geometry'];
                        util.each(g.PrimitiveSetList, function (drawInfos) {
                            util.each(drawInfos, function (drawInfo) {
                                var arrayInfo = drawInfo.Indices.Array;
                                util.each(arrayInfo, function (info) {
                                    list[info.File] = true;
                                });
                            });
                        });
                        util.each(g.VertexAttributeList, function (attrInfo) {
                            var arrayInfo = attrInfo.Array;
                            util.each(arrayInfo, function (info) {
                                list[info.File] = true;
                            });
                        });
                    }
                });
            }
            return list;
        },
        load: function (params) {
            var that = this;
            return that.loadRes(params.src, 'json')
                .then(json => {
                    var externalFiles = that.getBinFilesList(json['osg.Node']);
                    var buffers = {};
                    return Promise.all(Object.keys(externalFiles).map(function(path) {
                        return that.loadRes(util.getRelativePath(params.src, path), 'buffer').then(function (buffer) {
                            buffers[path] = buffer;
                        });
                    })).then(function () {
                        var rootNode = new Node();
                        that.parseNode(rootNode, json['osg.Node'], buffers, params.materials || {});
                        return {
                            node: rootNode
                        };
                    });
                }).catch(function (err) {
                    console.warn('load gltf failed', err.message, err.stack);
                    throw err;
                });
        }
    });

    Hilo3d.OSGLoader = OSGLoader;
    Hilo3d.Loader.addLoader('osg', OSGLoader);
})();