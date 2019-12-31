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

const readmeTask = () => {
    return src(['./README.md', './README_ZH.md'])
        .pipe(replace(/Hilo3d\/[\d\.]+\/Hilo3d\.js/g, `Hilo3d/${pkg.version}/Hilo3d.js`))
        .pipe(dest('./'));
};

const watchTask = () => {
    watch(['test/spec/**/*.js'], series(testBuildTask, testTask));
};

exports.test = series(testBuildTask, testTask);
exports.watch = series(testBuildTask, testTask, watchTask);
exports.readme = readmeTask;