const gitlabPath = '../Hilo3d';

const { src, dest, series, parallel } = require('gulp');
const del = require('del');
const replace = require('gulp-replace');

const pkg = require('./package.json');
const gitlabPkg = require(`${gitlabPath}/package.json`);

const delTask = (cb) => {
    del(['build', 'docs', 'examples', 'src', 'test', 'types'], {
        force:true
    }).then(()=>{
        cb();
    });
};

const copyTask =  () => {
    return src([
            `${gitlabPath}/+(build|examples|docs|types)/**/*`,
            `${gitlabPath}/+(src)/loader/**/*`,
            `${gitlabPath}/README.md`
        ])
        .pipe(dest('./'));
};

const versionTask = () => {
    return src('./package.json')
        .pipe(replace(/"version"[\s]*:[\s]*"[\d\.]+"/g, `"version": "${gitlabPkg.version}"`))
        .pipe(dest('./'))
};

exports.del = delTask;
exports.copy = series(delTask, copyTask);
exports.version = versionTask;
exports.default = series(parallel(versionTask, series(delTask, copyTask)), function logTask(cb){
    cb();
    console.log(`Hilo3d update: ${pkg.version} => ${gitlabPkg.version}`);
});