var Class = require('js-class');

    ManagementObject = require('./ManagementObject');

var Image = Class(ManagementObject, {
    constructor: function (id, props, options) {
        ManagementObject.prototype.constructor.call(this, 'image', id, props, options);
    }
});

module.exports = {
    create: function (id, props, refObjs, options, callback) {
        callback(null, new Image(id, props, options));
    },

    reload: function (data, callback) {
        callback(new Error('Not implemented'));
    }
};
