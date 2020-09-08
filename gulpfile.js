const { src, dest, series, watch } = require('gulp');
const uitest = require('gulp-uitest');
const replace = require('gulp-replace');
const concat = require('gulp-concat');
const pkg = require('./package.json');

const testBuildTask = () => {
    return src('test/spec/**/*.js')
        .pipe(replace(/^/, '(function(){\n'))
        .pipe(replace(/$/, '\n})();\n'))
        .pipe(concat('hilo3d.test.js'))
        .pipe(dest('test/'));
};

const testTask = () => {
    return src('test/index.html')
        .pipe(uitest({
            width: 600,
            height: 480,
            hidpi: false,
            useContentSize: true,
            show: false
        }));
};

const hilo3dTSDHeader = `export = hilo3d;
export as namespace hilo3d;
declare namespace hilo3d {

type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

`;

const hilo3dTSDFooter = `

}
`;

const addHilo3dTSD = () => {
    return src('./types/index.d.ts')
        .pipe(replace(/^/, hilo3dTSDHeader))
        .pipe(replace(/$/, hilo3dTSDFooter))
        .pipe(dest('types'));
};

const readmeTask = () => {
    return src(['./README.md', './README_ZH.md'])
        // //cdn.jsdelivr.net/npm/hilo3d@1.15.9-alpha.3/build/Hilo3d.js
        .pipe(replace(/\/hilo3d@[\d\.\w\-]+\/build\/Hilo3d\.js/g, `/hilo3d@${pkg.version}/build/Hilo3d.js`))
        .pipe(dest('./'));
};

const watchTask = () => {
    watch(['test/spec/**/*.js'], series(testBuildTask, testTask));
};

exports.test = series(testBuildTask, testTask);
exports.watch = series(testBuildTask, testTask, watchTask);
exports.readme = readmeTask;
exports.addHilo3dTSD = addHilo3dTSD;