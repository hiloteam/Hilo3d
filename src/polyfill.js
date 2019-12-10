import ObjectAssign from 'object-assign';
import objectKeys from 'object.keys';
import ObjectValues from 'object-values';
import pinkiePromise from 'pinkie-promise';

if (!Object.assign) {
    Object.assign = ObjectAssign;
}

if (!Object.keys) {
    Object.keys = objectKeys;
}

if (!Object.values) {
    Object.values = ObjectValues;
}

if (typeof Promise === 'undefined') {
    window.Promise = pinkiePromise;
}
