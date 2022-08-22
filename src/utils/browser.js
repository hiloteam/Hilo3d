/**
 * Hilo
 * Copyright 2015 alibaba.com
 * Licensed under the MIT License
 */

import log from './log';

/**
 * 浏览器特性集合
 * @namespace
 */
const browser = (function() {
    const ua = navigator.userAgent;
    const doc = document;
    const win = window;
    const docElem = doc.documentElement;

    const data = /** @lends browser */ {
        /**
         * 是否是iphone
         * @readOnly
         * @type {boolean}
         */
        iphone: /iphone/i.test(ua),

        /**
         * 是否是ipad
         * @readOnly
         * @type {boolean}
         */
        ipad: /ipad/i.test(ua),

        /**
         * 是否是ipod
         * @readOnly
         * @type {boolean}
         */
        ipod: /ipod/i.test(ua),

        /**
         * 是否是ios
         * @readOnly
         * @type {boolean}
         */
        ios: /iphone|ipad|ipod/i.test(ua),

        /**
         * 是否是android
         * @readOnly
         * @type {boolean}
         */
        android: /android/i.test(ua),

        /**
         * 是否是webkit
         * @readOnly
         * @type {boolean}
         */
        webkit: /webkit/i.test(ua),

        /**
         * 是否是chrome
         * @readOnly
         * @type {boolean}
         */
        chrome: /chrome/i.test(ua),

        /**
         * 是否是safari
         * @readOnly
         * @type {boolean}
         */
        safari: /safari/i.test(ua),

        /**
         * 是否是firefox
         * @readOnly
         * @type {boolean}
         */
        firefox: /firefox/i.test(ua),

        /**
         * 是否是ie
         * @readOnly
         * @type {boolean}
         */
        ie: /msie/i.test(ua),

        /**
         * 是否是opera
         * @readOnly
         * @type {boolean}
         */
        opera: /opera/i.test(ua),
        /**
         * 是否支持触碰事件。
         * @readOnly
         * @type {boolean}
         */
        supportTouch: 'ontouchstart' in win,

        /**
         * 是否支持canvas元素。
         * @readOnly
         * @type {boolean}
         */
        supportCanvas: !!doc.createElement('canvas').getContext,
        /**
         * 是否支持本地存储localStorage。
         * @readOnly
         * @type {boolean}
         */
        supportStorage: undefined,

        /**
         * 是否支持检测设备方向orientation。
         * @readOnly
         * @type {boolean}
         */
        supportOrientation: 'orientation' in win || 'orientation' in win.screen,

        /**
         * 是否支持检测加速度devicemotion。
         * @readOnly
         * @type {boolean}
         */
        supportDeviceMotion: 'ondevicemotion' in win,
    };

    // `localStorage` is null or `localStorage.setItem` throws error in some cases (e.g. localStorage is disabled)
    try {
        let value = 'hilo';
        localStorage.setItem(value, value);
        localStorage.removeItem(value);
        data.supportStorage = true;
    } catch (e) {
        data.supportStorage = false;
        log.warn('LocalStorage disabled');
    }

    /**
     * 浏览器厂商CSS前缀的js值。比如：webkit。
     * @memberOf browser
     * @readOnly
     * @type {string}
     */
    let jsVendor;

    if (data.webkit) {
        jsVendor = 'webkit';
    } else if (data.firefox) {
        jsVendor = 'webkit';
    } else if (data.opera) {
        jsVendor = 'o';
    } else if (data.ie) {
        jsVendor = 'ms';
    } else {
        jsVendor = '';
    }

    data.jsVendor = jsVendor;
    /**
     * 浏览器厂商CSS前缀的css值。比如：-webkit-。
     * @memberOf browser
     * @readOnly
     * @type {string}
     */
    let cssVendor = (data.cssVendor = '-' + jsVendor + '-');

    try {
        // css transform/3d feature dectection
        const testElem = doc.createElement('div');
        let style = testElem.style;
        /**
         * 是否支持CSS Transform变换。
         * @memberOf browser
         * @readOnly
         * @type {boolean}
         */
        const supportTransform = style[jsVendor + 'Transform'] !== undefined;

        /**
         * 是否支持CSS Transform 3D变换。
         * @memberOf browser
         * @readOnly
         * @type {boolean}
         */
        let supportTransform3D = style[jsVendor + 'Perspective'] !== undefined;
        if (supportTransform3D) {
            testElem.id = 'test3d';
            style = doc.createElement('style');
            style.textContent = '@media (' + cssVendor + 'transform-3d){#test3d{height:3px}}';
            doc.head.appendChild(style);

            docElem.appendChild(testElem);
            supportTransform3D = testElem.offsetHeight === 3;
            doc.head.removeChild(style);
            docElem.removeChild(testElem);
        }

        data.supportTransform = supportTransform;
        data.supportTransform3D = supportTransform3D;
    } catch (e) {
        data.supportTransform = false;
        data.supportTransform3D = false;
    }

    const supportTouch = data.supportTouch;

    /**
     * 鼠标或触碰开始事件。对应touchstart或mousedown。
     * @memberOf browser
     * @readOnly
     * @type {string}
     */
    const POINTER_START = supportTouch ? 'touchstart' : 'mousedown';

    /**
     * 鼠标或触碰移动事件。对应touchmove或mousemove。
     * @memberOf browser
     * @readOnly
     * @type {string}
     */
    const POINTER_MOVE = supportTouch ? 'touchmove' : 'mousemove';

    /**
     * 鼠标或触碰结束事件。对应touchend或mouseup。
     * @memberOf browser
     * @readOnly
     * @type {string}
     */
    const POINTER_END = supportTouch ? 'touchend' : 'mouseup';

    data.POINTER_START = POINTER_START;
    data.POINTER_MOVE = POINTER_MOVE;
    data.POINTER_END = POINTER_END;

    return data;
}());

export default browser;
