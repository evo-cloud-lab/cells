var Class   = require('js-class'),
    flow    = require('js-flow'),
    yaml    = require('js-yaml'),
    path    = require('path'),
    fs      = require('fs'),

    ManagementObject = require('./ManagementObject');

var Image = Class(ManagementObject, {
    constructor: function (id, props, options) {
        ManagementObject.prototype.constructor.call(this, 'image', id, props, options);
        this._basedir = props.dir;
    },

    get basedir () {
        return this._basedir;
    },

    get manifest () {
        return this._manifest;
    },

    get mounts () {
        return this._mounts;
    },

    findMount: function (format) {
        var found;
        this._mounts && this._mounts.some(function (mount) {
            if (mount.format.name == format) {
                found = mount;
                return true;
            }
            return false;
        });
        return found;
    },

    setup: function (callback) {
        flow.steps()
            .chain()
            .next(function (next) {
                fs.readFile(path.join(this._basedir, 'manifest.yml'), next);
            })
            .next(function (manifest, next) {
                try {
                    this._manifest = yaml.load(manifest.toString());
                } catch (e) {
                    next(e);
                    return;
                }
                var formats = Array.isArray(this._manifest.formats) ? this._manifest.formats : [];
                flow.each(formats)
                    .map(function (format, next) {
                        if (format && format.name) {
                            flow.steps()
                                .chain()
                                .next(function (next) {
                                    this.connectPlugin(
                                        'cells:image.format.' + format.name,
                                        format.driver,
                                        { params: format },
                                        next
                                    );
                                })
                                .next(function (driver, next) {
                                    if (driver) {
                                        driver.mount(this._basedir, function (err, mount) {
                                            next(err, {
                                                format: format,
                                                driver: driver,
                                                mountpoint: mount
                                            });
                                        });
                                    } else {
                                        next(null, { format: format });
                                    }
                                })
                                .with(this)
                                .run(next);
                        } else {
                            next(null, null);
                        }
                    })
                    .with(this)
                    .run(next);
            })
            .next(function (mounts, next) {
                this._mounts = mounts.filter(function (mount) { return mount != null; });
                next();
            })
            .with(this)
            .run(callback);
    },

    dump: function () {
        return {
            name: this.name,
            basedir: this._basedir,
            manifest: this._manifest,
            mounts: this._mounts && this._mounts.map(function (mount) {
                return {
                    format: mount.format,
                    mountpoint: mount.mountpoint && mount.mountpoint.toObject()
                };
            })
        };
    },

    _destruct: function (callback) {
        if (this._mounts) {
            flow.each(this._mounts)
                .ignoreErrors()
                .do(function (mount, next) {
                    mount.mountpoint && mount.mountpoint.umount(next);
                })
                .run(callback);
        } else {
            callback();
        }
    }
});

module.exports = {
    exports: 'RD',

    create: function (id, props, refObjs, options, callback) {
        var image = new Image(id, props, options);
        image.setup(function (err) {
            callback(err, image);
        });
    }
};
