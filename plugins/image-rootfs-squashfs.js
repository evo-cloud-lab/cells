var Class = require('js-class'),
    flow  = require('js-flow'),
    path  = require('path'),
    mkdir = require('mkdirp'),
    Errors = require('evo-elements').Errors,
    sh    = require('../lib/ShellExec').sh;

var MountPoint = Class({
    constructor: function (mountdir, image) {
        this._path = mountdir;
        this._image = image;
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
        sh(this._image.logger, 'umount ' + this._path, callback);
    }
});

var Squashfs = Class({
    constructor: function (format, image) {
        this._format = format;
        this._image = image;
    },

    mount: function (baseDir, callback) {
        var filename = this._format.file;
        var mountdir = this._format.mountdir;
        if (!filename) {
            callback(Errors.noAttr('file'));
        } else if (!mountdir) {
            callback(Errors.noAttr('mountdir'));
        } else {
            mountdir = path.join(baseDir, mountdir);
            filename = path.join(baseDir, filename);
            flow.steps()
                .next(function (next) {
                    mkdir(mountdir, next);
                })
                .next(function (next) {
                    sh(this._image.logger, 'mount -t squashfs ' + filename + ' ' + mountdir, next);
                })
                .with(this)
                .run(function (err) {
                    callback(err, err ? null : new MountPoint(mountdir, this._image));
                });
        }
    }
});

module.exports = function (data, image, info, callback) {
    var driver = new Squashfs(data, image);
    callback(null, driver);
};
