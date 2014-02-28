var Class = require('js-class'),
    path  = require('path');

var MountPoint = Class({
    constructor: function (mountdir) {
        this._path = mountdir;
    },

    get path () {
        return this._path;
    },

    toObject: function () {
        return {
            path: this._path
        }
    },

    umount: function (callback) {
        callback();
    }
});

var Dir = Class({
    constructor: function (format, image) {
        this._format = format;
        this._image = image;
    },

    mount: function (baseDir, callback) {
        var dir = this._format.dir;
        dir = dir ? path.join(baseDir, dir) : baseDir;
        callback(null, new MountPoint(dir));
    }
});

module.exports = function (data, image, info, callback) {
    var driver = new Dir(data.params, image);
    callback(null, driver);
};
