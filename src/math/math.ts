/** 常用数学工具。 */
const math = {
    DEG2RAD: Math.PI / 180,
    RAD2DEG: 180 / Math.PI,

    generateUUID: (() => {
        let uid = 0;
        return (prefix = ''): string => {
            const id = ++uid;
            return prefix ? `${prefix}_${id}` : String(id);
        };
    })(),

    clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    },

    degToRad(degrees: number): number {
        return degrees * this.DEG2RAD;
    },

    radToDeg(radians: number): number {
        return radians * this.RAD2DEG;
    },

    isPowerOfTwo(value: number): boolean {
        return (value & (value - 1)) === 0 && value !== 0;
    },

    nearestPowerOfTwo(value: number): number {
        return 2 ** Math.round(Math.log(value) / Math.LN2);
    },

    nextPowerOfTwo(value: number): number {
        let result = value - 1;
        result |= result >> 1;
        result |= result >> 2;
        result |= result >> 4;
        result |= result >> 8;
        result |= result >> 16;
        return result + 1;
    }
};

export default math;
