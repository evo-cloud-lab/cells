var Class = require('js-class'),

    ManagementObject = require('./ManagementObject');

var Cluster = Class(ManagementObject, {
    constructor: function (id, props, options) {
        ManagementObject.prototype.constructor.call(this, 'cluster', id, props, options);
        this.name = this.properties.name;
    },

    dump: function () {
        return {
            name: this.name
        };
    }
});

module.exports = {
    export: true,

    create: function (id, props, refObjs, options, callback) {
        callback(null, new Cluster(id, props, options));
    },

    reload: function (data, callback) {
        callback(new Error('Not implemented'));
    }
};
