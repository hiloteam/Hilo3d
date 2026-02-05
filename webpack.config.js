const webpack = require('webpack');
const WrapperPlugin = require('wrapper-webpack-plugin');
const pkg = require('./package.json');

const header = `
/*!
 * Hilo3d ${pkg.version}
 * Copyright (c) 2017-present Alibaba Group Holding Ltd.
 * @license MIT
 */
`;

const footer = `
if(typeof window !== 'undefined' && window.Hilo3d){
    if(typeof exports === 'object' && typeof module === 'object'){
        module.exports = window.Hilo3d;
    }
}
`;

module.exports = function(env, argv) {
    let isDev = env;
    let isDebug = env && env.debug;
    let mode = isDev ? 'development' : 'production'; 
    return {
        module: {
            rules: [{
                enforce: 'pre',
                test: /\.(js|ts)$/,
                loader: 'string-replace-loader',
                options: {
                    multiple: [{
                        // HILO_DEBUG_START HILO_DEBUG_END
                        search: '\\/\\/\\s*HILO_DEBUG_START\\s+([\\s\\S]+?)\\s+\\/\\/\\s*HILO_DEBUG_END',
                        replace: `${isDebug?'$1':''}`,
                        flags:'g'
                    }]
                }
            }, {
                test: /\.ts$/,
                exclude: /(node_modules|bower_components)/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        transpileOnly: true
                    }
                }
            }, {
                test: /\.(glsl|frag|vert)$/,
                exclude: /node_modules/,
                loader: 'glslify-import-loader'
            }, {
                test: /\.(glsl|frag|vert)$/,
                exclude: /node_modules/,
                loader: 'raw-loader'
            }, {
                test: /\.(glsl|frag|vert)$/,
                exclude: /node_modules/,
                loader: 'glslify-loader'
            }, {
                test: /\.js$/,
                // exclude: /(node_modules|bower_components)/,
                loader: 'babel-loader',
                options: {
                    presets: [['@babel/preset-env', {
                            exclude:['transform-typeof-symbol']
                        }]
                    ]
                }
            }]
        },
        entry: isDev ? {
            Hilo3d: ['./src/polyfill.ts', './src/Hilo3d.ts']
        } : {
            polyfill: ['./src/polyfill.ts'],
            'Hilo3d.single': './src/Hilo3d.ts',
            'math.single': './src/math.ts',
            Hilo3d: ['./src/polyfill.ts', './src/Hilo3d.ts']
        },
        output: {
            path: __dirname + (argv && argv.seinjs ? '/seinjs-build' : '/build'),
            filename: '[name].js',
            library: 'Hilo3d',
            libraryTarget: "window"
        },
        plugins: [
            new webpack.LoaderOptionsPlugin({
                options: {}
            }),
            new webpack.DefinePlugin({
                HILO3D_VERSION: JSON.stringify(pkg.version)
            }),
            new webpack.optimize.ModuleConcatenationPlugin(),
            new WrapperPlugin({
                header: header,
                footer: footer,
                test: ['Hilo3d.js', 'Hilo3d.single.js', 'math.single.js']
            }),
        ],
        resolve: {
            extensions: ['.ts', '.js'],
            alias: {
                "gl-matrix": "gl-matrix/dist/gl-matrix-min.js"
            }
        },
        mode: mode,
        devtool: 'none'
    }
}
