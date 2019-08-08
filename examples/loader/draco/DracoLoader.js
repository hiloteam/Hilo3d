(function() {
    var Class = Hilo3d.Class;
    var BasicLoader = Hilo3d.BasicLoader;
    var Geometry = Hilo3d.Geometry;
    var GeometryData = Hilo3d.GeometryData;

    var dracoDecoder = window.dracoDecoder = new DracoDecoderModule();
    dracoDecoder.onModuleLoaded = function(module) {
        dracoDecoder = module;
    }

    function getAttributeData(decoder, dracoGeometry, attribute) {
        if (attribute.ptr === 0) {
            return null;
        }

        var numComponents = attribute.num_components();
        var attributeData = new dracoDecoder.DracoFloat32Array();

        decoder.GetAttributeFloatForAllPoints(dracoGeometry, attribute, attributeData);
        var numPoints = dracoGeometry.num_points();
        var numValues = numPoints * numComponents;
        var result = new Float32Array(numValues);
        for (var i = 0; i < numValues; i++) {
            result[i] = attributeData.GetValue(i);
        }
        return result;
    }

    function decode(byteArray, info, primitive) {
        var attributesMap = info.attributes;
        var buffer = new dracoDecoder.DecoderBuffer();
        buffer.Init(byteArray, byteArray.byteLength);
        var decoder = new dracoDecoder.Decoder();

        var geometryType = decoder.GetEncodedGeometryType(buffer);
        var dracoGeometry, decodingStatus;
        if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
            dracoGeometry = new dracoDecoder.Mesh();
            decodingStatus = decoder.DecodeBufferToMesh(buffer, dracoGeometry);
        } else {
            dracoGeometry = new dracoDecoder.PointCloud();
            decodingStatus = decoder.DecodeBufferToPointCloud(buffer, dracoGeometry);
        }

        if (!decodingStatus.ok() || dracoGeometry.ptr == 0) {
            console.error('decodingStatus error');
            return;
        }
        dracoDecoder.destroy(buffer);

        var geometry = primitive._geometry || new Geometry();

        var numFaces = dracoGeometry.num_faces();
        var numPoints = dracoGeometry.num_points();
        // Verify if there is position attribute.
        var posAttId = decoder.GetAttributeId(dracoGeometry,
            dracoDecoder.POSITION);
        if (posAttId == -1) {
            var errorMsg = 'THREE.DRACOLoader: No position attribute found.';
            console.error(errorMsg);
            dracoDecoder.destroy(decoder);
            dracoDecoder.destroy(dracoGeometry);
            throw new Error(errorMsg);
        }
        var posAttribute = decoder.GetAttribute(dracoGeometry, posAttId);
        var posTransform = new dracoDecoder.AttributeQuantizationTransform();
        if (posTransform.InitFromAttribute(posAttribute)) {

        }

        var dracoAttributesMap = {
            POSITION: ['vertices', 3],
            NORMAL: ['normals', 3],
            TANGENT: ['tangents', 4],
            TEX_COORD: ['uvs', 2],
            TEXCOORD_0: ['uvs', 2],
            TEXCOORD_1: ['uvs1', 2],
            COLOR: ['color', 2],
            COLOR_0: ['color', 2],
            JOINTS_0: ['skinIndices', 4],
            WEIGHTS_0: ['skinWeights', 4],
        };

        var attributeUsedMap = {};
        for (var attributeName in dracoAttributesMap) {
            var info = dracoAttributesMap[attributeName];
            var attId = decoder.GetAttributeId(dracoGeometry, dracoDecoder[attributeName]);
            if (dracoDecoder[attributeName] !== undefined && attId !== -1) {
                var attribute = decoder.GetAttribute(dracoGeometry, attId);
                var data = getAttributeData(decoder, dracoGeometry, attribute);
                if (data) {
                    geometry[info[0]] = new GeometryData(data, info[1]);
                }
                attributeUsedMap[info[0]] = true;
            }
        }

        for (var attributeName in attributesMap) {
            var info = dracoAttributesMap[attributeName];
            if (!info) {
                console.warn(attributeName + ' not exist');
                continue;
            }
            if (attributeUsedMap[info[0]]) {
                continue;
            }
            var attributeId = attributesMap[attributeName];
            var attribute = decoder.GetAttributeByUniqueId(dracoGeometry,
                attributeId);
            var data = getAttributeData(decoder, dracoGeometry, attribute);
            if (data) {
                geometry[info[0]] = new GeometryData(data, info[1]);
            }
        }

        if (geometry._tangents) {
            if (geometry._tangents.length > geometry.vertices.length) {
                geometry._tangents.stride = 16;
                geometry._tangents.size = 3;
            }
        }

        if (geometry.skinIndices) {
            var x = geometry.skinIndices.data;
            for (var i = x.length - 1; i >= 0; i--) {
                x[i] = Math.round(x[i]);
            }
        }

        var indicesArray;
        if (numPoints > 65535) {
            indicesArray = new Uint32Array(numFaces * 3);
        } else {
            indicesArray = new Uint16Array(numFaces * 3);
        }
        var ia = new dracoDecoder.DracoInt32Array();
        for (var i = 0; i < numFaces; i++) {
            decoder.GetFaceFromMesh(dracoGeometry, i, ia);
            var idx = i * 3;
            indicesArray[idx] = ia.GetValue(0);
            indicesArray[idx + 1] = ia.GetValue(1);
            indicesArray[idx + 2] = ia.GetValue(2);
        }
        geometry.indices = new GeometryData(indicesArray, 1);

        dracoDecoder.destroy(ia);
        dracoDecoder.destroy(dracoGeometry);
        dracoDecoder.destroy(decoder);
        return geometry;
    }


    var DracoLoader = Class.create({
        Extends: BasicLoader,
        Statics: {
            decode: decode
        },
        constructor: function() {
            DracoLoader.superclass.constructor.call(this);
        },
        load: function(params) {
            return this.loadRes(params.src, 'buffer')
                .then(function(data) {
                    return decode(data);
                }).catch(function(err) {
                    console.warn('load draco failed', err);
                    throw err;
                });
        }
    });

    Hilo3d.DracoLoader = DracoLoader;
    Hilo3d.Loader.addLoader('drc', DracoLoader);

    Hilo3d.GLTFParser.extensionHandlers.KHR_draco_mesh_compression = {
        parse: function(info, parser, result, primitive) {
            var bufferView = parser.bufferViews[info.bufferView];
            var uintArray = new Uint8Array(bufferView.buffer, bufferView.byteOffset, bufferView.byteLength);
            var geometry = decode(uintArray, info, primitive);
            return geometry;
        }
    };
})();