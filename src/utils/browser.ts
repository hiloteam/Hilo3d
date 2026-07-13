export interface BrowserFeatures {
    supportTouch: boolean;
    supportCanvas: boolean;
    supportStorage: boolean;
    supportOrientation: boolean;
    supportDeviceMotion: boolean;
    supportPointerEvents: boolean;
    readonly POINTER_START: 'pointerdown';
    readonly POINTER_MOVE: 'pointermove';
    readonly POINTER_END: 'pointerup';
    readonly POINTER_CANCEL: 'pointercancel';
    readonly POINTER_OUT: 'pointerout';
}

function detectStorageSupport(windowObject: Window | undefined): boolean {
    if (!windowObject) return false;
    try {
        const key = '__hilo3d_storage_test__';
        windowObject.localStorage.setItem(key, key);
        windowObject.localStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}

/** Feature detection for the modern browser APIs used by Hilo3d. */
export function detectBrowserFeatures(): BrowserFeatures {
    const windowObject = typeof window === 'undefined' ? undefined : window;
    const navigatorObject = typeof navigator === 'undefined' ? undefined : navigator;
    const documentObject = typeof document === 'undefined' ? undefined : document;

    return {
        supportTouch: (navigatorObject?.maxTouchPoints ?? 0) > 0,
        supportCanvas:
            documentObject !== undefined &&
            typeof documentObject.createElement('canvas').getContext === 'function',
        supportStorage: detectStorageSupport(windowObject),
        supportOrientation: windowObject !== undefined && 'orientation' in windowObject.screen,
        supportDeviceMotion: windowObject !== undefined && 'DeviceMotionEvent' in windowObject,
        supportPointerEvents: windowObject !== undefined && 'PointerEvent' in windowObject,
        POINTER_START: 'pointerdown',
        POINTER_MOVE: 'pointermove',
        POINTER_END: 'pointerup',
        POINTER_CANCEL: 'pointercancel',
        POINTER_OUT: 'pointerout'
    };
}

const browser = detectBrowserFeatures();

export default browser;
