import Class from '../core/Class';
import Plane from './Plane';

/**
 * 平截头体
 * @class
 */
const Frustum = Class.create(/** @lends Frustum.prototype */ {
    /**
     * 类名
     * @type {String}
     * @default Frustum
     */
    className: 'Frustum',
    /**
     * @type {Boolean}
     * @default true
     */
    isFrustum: true,
    /**
     * @constructs
     */
    constructor() {
        this.planes = [];
        let num = 6;
        while (num--) {
            this.planes.push(new Plane());
        }
    },
    /**
     * Copy the values from one frustum to this
     * @param  {Frustum} m the source frustum
     * @return {Frustum} this
     */
    copy(frustum) {
        const planes = frustum.planes;
        this.planes.forEach((plane, index) => {
            plane.copy(planes[index]);
        });
        return this;
    },
    /**
     * Creates a new frustum initialized with values from this frustum
     * @return {Frustum} a new Frustum
     */
    clone() {
        const frustum = new this.constructor();
        frustum.copy(this);
        return frustum;
    },
    /**
     * fromMatrix
     * @param  {Matrix4} mat
     * @return {Frustum}  this
     */
    fromMatrix(mat) {
        // Based on https://github.com/mrdoob/three.js/blob/dev/src/math/Frustum.js#L63

        const planes = this.planes;
        const me = mat.elements;
        const me0 = me[0];
        const me1 = me[1];
        const me2 = me[2];
        const me3 = me[3];
        const me4 = me[4];
        const me5 = me[5];
        const me6 = me[6];
        const me7 = me[7];
        const me8 = me[8];
        const me9 = me[9];
        const me10 = me[10];
        const me11 = me[11];
        const me12 = me[12];
        const me13 = me[13];
        const me14 = me[14];
        const me15 = me[15];

        planes[0].set(me3 - me0, me7 - me4, me11 - me8, me15 - me12).normalize();
        planes[1].set(me3 + me0, me7 + me4, me11 + me8, me15 + me12).normalize();
        planes[2].set(me3 + me1, me7 + me5, me11 + me9, me15 + me13).normalize();
        planes[3].set(me3 - me1, me7 - me5, me11 - me9, me15 - me13).normalize();
        planes[4].set(me3 - me2, me7 - me6, me11 - me10, me15 - me14).normalize();
        planes[5].set(me3 + me2, me7 + me6, me11 + me10, me15 + me14).normalize();

        return this;
    },
    /**
     * 与球体相交
     * @param  {Sphere} sphere
     * @return {Boolean} 是否相交
     */
    intersectsSphere(sphere) {
        const planes = this.planes;
        const center = sphere.center;
        const negRadius = -sphere.radius;

        for (let i = 0; i < 6; i++) {
            const distance = planes[i].distanceToPoint(center);

            if (distance < negRadius) {
                return false;
            }
        }

        return true;
    }
});

export default Frustum;
