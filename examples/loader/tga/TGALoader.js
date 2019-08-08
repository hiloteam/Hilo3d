(function () {
    var Class = Hilo3d.Class;
    var BasicLoader = Hilo3d.BasicLoader;
    var DataTexture = Hilo3d.DataTexture;

    var TGALoader = Class.create({
        Extends: BasicLoader,
        constructor: function () {
            TGALoader.superclass.constructor.call(this);
        },
        load: function (params) {
            var that = this;
            return this.loadRes(params.src, 'buffer')
                .then(function (buffer) {
                    console.time('parse tga image');
                    var header = that.readHeader(buffer);
                    that.check(header);
                    var pixels = that.readPixels(header, buffer);
                    console.timeEnd('parse tga image');
                    return that.createTexture(header, pixels);
                });
        },
        readHeader: function(buffer) {
            var dv = new DataView(buffer, 0, 18);
            var header = {};
            header.idlength = dv.getInt8(0);
            header.colourMapType = dv.getInt8(1);
            header.dataTypeCode = dv.getInt8(2);
            header.colourMapOrigin = dv.getInt16(3, true);
            header.colourMapLength = dv.getInt16(5, true);
            header.colourMapDepth = dv.getInt8(7);
            header.xOrigin = dv.getInt16(8, true);
            header.yOrigin = dv.getInt16(10, true);
            header.width = dv.getInt16(12, true);
            header.height = dv.getInt16(14, true);
            header.bitsPerPixel = dv.getInt8(16);
            header.bytesPerPixel = header.bitsPerPixel / 8;
            header.imageDescriptor = dv.getInt8(17);
            return header;
        },
        check(header) {
            /* What can we handle */
            if (header.dataTypeCode != 2 && header.dataTypeCode != 10) {
                throw new Error('TGALoader Can only handle image type 2 and 10');
            }
            if (header.bitsPerPixel != 16 && 
                header.bitsPerPixel != 24 && header.bitsPerPixel != 32) {
                throw new Error('TGALoader Can only handle pixel depths of 16, 24, and 32');
            }
            if (header.colourMapType != 0 && header.colourMapType != 1) {
                throw new Error('TGALoader Can only handle colour map types of 0 and 1');
            }
        },
        addPixel: function(arr, offset, count, pixels, idx) {
            idx *= 4;
            var r = 255;
            var g = 255;
            var b = 255;
            var a = 255;
            if (count === 3 || count === 4) {
                r = arr[offset + 2];
                g = arr[offset + 1];
                b = arr[offset];
                a = count === 4 ? arr[offset + 3] : 255;
            } else if (count === 2) {
                r = (arr[offset + 1] & 0x7c) << 1;
                g = ((arr[offset + 1] & 0x03) << 6) | ((arr[offset] & 0xe0) >> 2);
                b = (arr[offset] & 0x1f) << 3;
                a = (arr[offset + 1] & 0x80);
            } else {
                console.error('cant transform to Pixel');
            }

            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
        },
        readPixels: function (header, buffer) {
            var bytesPerPixel = header.bytesPerPixel;
            var pixelCount = header.width * header.height;
            var data = new Uint8Array(buffer);
            var pixels = new Uint8Array(pixelCount * 4);
            var offset = 18;

            for (var i = 0; i < pixelCount; i++) {
                if (header.dataTypeCode === 2) {
                    this.addPixel(data, offset, bytesPerPixel, pixels, i);
                } else if (header.dataTypeCode === 10) {
                    var flag = data[offset++];
                    var count = flag & 0x7f;
                    var isRLEChunk = flag & 0x80;
                    this.addPixel(data, offset, bytesPerPixel, pixels, i);
                    for (var j = 0; j < count; j++) {
                        if (!isRLEChunk) {
                            offset += bytesPerPixel;
                        }
                        this.addPixel(data, offset, bytesPerPixel, pixels, ++i);
                    }
                }
                offset += bytesPerPixel;
            }

            return pixels;
        },
        createTexture(header, pixels) {
            return new DataTexture({
                width: header.width,
                height: header.height,
                flipY: true,
                image: pixels,
                type: Hilo3d.constants.UNSIGNED_BYTE
            });
        }
    });

    Hilo3d.TGALoader = TGALoader;
    Hilo3d.Loader.addLoader('tga', TGALoader);
})();