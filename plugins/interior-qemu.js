var Class = require('js-class'),
    flow  = require('js-flow'),
    exec  = require('child_process').exec,
    shell = require('../lib/ShellExec').shell;

var Qemu = Class({
    constructor: function (node, executable, params, monitor, logger) {
        this._node    = node;
        this._logger  = logger;
        this._monitor = monitor;

        if (!node.image) {
            throw new Error('Image is required');
        }

        this._mount = node.image.findMount('qemu');
        this._mount || (this._mount = node.image.findMount('vmdk'));
        if (!this._mount) {
            throw new Error('Image not supported');
        }

        this._disk = path.join(node.workdir, 'system' + path.extname(this._mount.path));
    },

    get id () {
        return this._node.id;
    },

    load: function (opts, callback) {
        flow.steps()
            .chain()
            .next(function (next) {
                exec('qemu-img info ' + this._mount.path, next);
            })
            .next(function (stdout, stderr, next) {
                exec('qemu-img create -b ' + this._mount.path + ' ' + this._disk, next);
            })
            .with(this)
            .run(callback);
    },

    unload: function (opts, callback) {
        fs.unlink(this._disk, callback);
    },

    start: function (opts, callback) {
    },

    stop: function (opts, callback) {
    },
});


module.exports = function (data, node, info, callback) {
    var executable = data.params['qemu'] ? data.params['qemu'] : (data.params['arch'] ? 'qemu-system-' + data.params['arch'] : 'kvm');
    flow.each([executable + ' -version'])
        .do(exec)
        .run(function (err) {
            var interior;
            if (!err) {
                try {
                    interior = new Qemu(node, executable, data.params, data.monitor, data.logger);
                } catch (e) {
                    err = e;
                }
            }
            callback(err, interior);
        });
};
