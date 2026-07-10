/**
 * Hilo
 * Copyright 2015 alibaba.com
 * Licensed under the MIT License
 */

import log from './log';

interface BrowserFeatures {
    iphone: boolean;
    ipad: boolean;
    ipod: boolean;
    ios: boolean;
    android: boolean;
    webkit: boolean;
    chrome: boolean;
    safari: boolean;
    firefox: boolean;
    ie: boolean;
    opera: boolean;
    supportTouch: boolean;
    supportCanvas: boolean;
    supportStorage: boolean;
    supportOrientation: boolean;
    supportDeviceMotion: boolean;
    jsVendor: '' | 'webkit' | 'Moz' | 'O' | 'ms';
    cssVendor: '' | '-webkit-' | '-moz-' | '-o-' | '-ms-';
    supportTransform: boolean;
    supportTransform3D: boolean;
    POINTER_START: 'touchstart' | 'mousedown';
    POINTER_MOVE: 'touchmove' | 'mousemove';
    POINTER_END: 'touchend' | 'mouseup';
}

function detectCssSupport(
    documentObject: Document | undefined,
    jsVendor: BrowserFeatures['jsVendor']
): Pick<BrowserFeatures, 'supportTransform' | 'supportTransform3D'> {
    if (!documentObject) {
        return { supportTransform: false, supportTransform3D: false };
    }

    const style = documentObject.createElement('div').style;
    const properties = style as unknown as Record<string, unknown>;
    const transformProperty = jsVendor ? `${jsVendor}Transform` : 'transform';
    const perspectiveProperty = jsVendor ? `${jsVendor}Perspective` : 'perspective';

    return {
        supportTransform: 'transform' in style || properties[transformProperty] !== undefined,
        supportTransform3D: 'perspective' in style || properties[perspectiveProperty] !== undefined
    };
}

function getVendor(features: Pick<
    BrowserFeatures,
    'webkit' | 'firefox' | 'opera' | 'ie'
>): Pick<BrowserFeatures, 'jsVendor' | 'cssVendor'> {
    if (features.webkit) return { jsVendor: 'webkit', cssVendor: '-webkit-' };
    if (features.firefox) return { jsVendor: 'Moz', cssVendor: '-moz-' };
    if (features.opera) return { jsVendor: 'O', cssVendor: '-o-' };
    if (features.ie) return { jsVendor: 'ms', cssVendor: '-ms-' };
    return { jsVendor: '', cssVendor: '' };
}

/** 浏览器特性集合；在 SSR/Node 环境中安全地返回全部能力为 false。 */
function detectBrowser(): BrowserFeatures {
    const windowObject = typeof window === 'undefined' ? undefined : window;
    const documentObject = typeof document === 'undefined' ? undefined : document;
    const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const iphone = /iphone/iu.test(userAgent);
    const ipad = /ipad/iu.test(userAgent);
    const ipod = /ipod/iu.test(userAgent);
    const webkit = /webkit/iu.test(userAgent);
    const chrome = /(?:chrome|crios)/iu.test(userAgent);
    const supportTouch = windowObject !== undefined && 'ontouchstart' in windowObject;
    const platform = {
        iphone,
        ipad,
        ipod,
        ios: iphone || ipad || ipod,
        android: /android/iu.test(userAgent),
        webkit,
        chrome,
        safari: /safari/iu.test(userAgent) && !chrome,
        firefox: /firefox/iu.test(userAgent),
        ie: /(?:msie|trident)/iu.test(userAgent),
        opera: /(?:opera|opr)/iu.test(userAgent)
    };
    const vendor = getVendor(platform);
    const cssSupport = detectCssSupport(documentObject, vendor.jsVendor);

    let supportStorage = false;
    if (windowObject) {
        try {
            const key = '__hilo3d_storage_test__';
            windowObject.localStorage.setItem(key, key);
            windowObject.localStorage.removeItem(key);
            supportStorage = true;
        } catch {
            log.warn('LocalStorage disabled');
        }
    }

    return {
        ...platform,
        ...vendor,
        ...cssSupport,
        supportTouch,
        supportCanvas: documentObject
            ? typeof documentObject.createElement('canvas').getContext === 'function'
            : false,
        supportStorage,
        supportOrientation: windowObject !== undefined
            && (Reflect.has(windowObject, 'orientation')
                || Reflect.has(windowObject.screen, 'orientation')),
        supportDeviceMotion: windowObject !== undefined && 'ondevicemotion' in windowObject,
        POINTER_START: supportTouch ? 'touchstart' : 'mousedown',
        POINTER_MOVE: supportTouch ? 'touchmove' : 'mousemove',
        POINTER_END: supportTouch ? 'touchend' : 'mouseup'
    };
}

const browser = detectBrowser();

export type { BrowserFeatures };
export default browser;
