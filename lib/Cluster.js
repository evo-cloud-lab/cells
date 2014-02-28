var Class = require('js-class'),
    path  = require('path'),
    mkdir = require('mkdirp'),

    ManagementObject = require('./ManagementObject');

var Cluster = Class(ManagementObject, {
    constructor: function (id, props, options) {
        ManagementObject.prototype.constructor.call(this, 'cluster', id, props, options);
        this._workdir = path.join(this.config['workdir'] || '/tmp', 'cells-cluster-' + id);
    },

    get workdir () {
        return this._workdir;
    },

    setup: function (callback) {
        mkdir(this.workdir, callback);
    },

    dump: function () {
        return {
            name: this.name,
            workdir: this.workdir
        };
    }
});

module.exports = {
    exports: 'CRUD',

    create: function (id, props, refObjs, options, callback) {
        var cluster = new Cluster(id, props, options);
        cluster.setup(function (err) {
            callback(err, cluster);
        });
    }
};
