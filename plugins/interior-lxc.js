var Class = require('js-class'),
    flow  = require('js-flow'),
    fs    = require('fs'),
    path  = require('path'),
    mkdir = require('mkdirp'),
    exec  = require('child_process').exec,
    spawn = require('child_process').spawn,
    sh    = require('../lib/ShellExec').sh;

var Lxc = Class({
    constructor: function (node, params, monitor, logger) {
        this._node    = node;
        this._logger  = logger;
        this._monitor = monitor;

        if (!node.image) {
            throw new Error('Image is required');
        }

        this._mount = node.image.findMount('rootfs');
        if (!this._mount) {
            throw new Error('Image not properly mounted');
        }

        this._mountpoint = path.join(node.workdir, 'root');

        this._conf = [
            'lxc.rootfs=' + this._mountpoint,
            'lxc.utsname=' + (params.utsname || 'linux'),
            'lxc.devttydir=',
            'lxc.tty=' + (params.tty == null ? 4 : params.tty),
            'lxc.pts=' + (params.pts == null ? 1024 : params.pts),
            'lxc.cap.drop=sys_module mac_admin' + (params['drop-caps'] ? ' ' + params['drop-caps'] : '')
        ];
        var arch = params.arch || node.image.manifest.arch;
        arch && this._conf.push('lxc.arch=' + arch);
        var aaProfile = params['aa-profile'] || node.image.manifest['aa-profile'];
        aaProfile && this._conf.push('lxc.aa_profile=' + aaProfile);

        Array.isArray(params.nics) && params.nics.forEach(function (nic) {
            var connectivity = typeof(nic) == 'string' ? { network: nic } : nic;
            var network = node.network(connectivity.network);
            if (!network) {
                throw new Error('Network not found: ' + connectivity.network);
            }
            this._conf.push('lxc.network.type=veth');
            this._conf.push('lxc.network.flags=up');
            var device = network.device;
            device && device.type == 'bridge' && this._conf.push('lxc.network.link=' + device.name);
            if (!isNaN(nic['address-index'])) {
                var subnet = network.subnet;
                if (!subnet) {
                    throw new Error('Subnet unavailable');
                }
                var address = subnet.addressAt(nic['address-index']);
                if (!address) {
                    throw new Error('Network address invalid: ' + nic['address-index'] + ' in ' + network.name);
                } else {
                    this._conf.push('lxc.network.hwaddr=' + address.mac);
                    address.ip && this._conf.push('lxc.network.ipv4=' + address.ip);
                }
            }
        }, this);

        if (!params['no-default-cgroup']) {
            this._conf = this._conf.concat([
                'lxc.cgroup.devices.deny = a',
                'lxc.cgroup.devices.allow = c *:* m',
                'lxc.cgroup.devices.allow = b *:* m',
                'lxc.cgroup.devices.allow = c 1:3 rwm',
                'lxc.cgroup.devices.allow = c 1:5 rwm',
                'lxc.cgroup.devices.allow = c 5:1 rwm',
                'lxc.cgroup.devices.allow = c 5:0 rwm',
                'lxc.cgroup.devices.allow = c 4:0 rwm',
                'lxc.cgroup.devices.allow = c 4:1 rwm',
                'lxc.cgroup.devices.allow = c 1:9 rwm',
                'lxc.cgroup.devices.allow = c 1:8 rwm',
                'lxc.cgroup.devices.allow = c 136:* rwm',
                'lxc.cgroup.devices.allow = c 5:2 rwm',
                'lxc.cgroup.devices.allow = c 254:0 rwm',
                'lxc.cgroup.devices.allow = c 10:229 rwm',
                'lxc.cgroup.devices.allow = c 10:200 rwm',
                'lxc.cgroup.devices.allow = c 1:7 rwm',
                'lxc.cgroup.devices.allow = c 10:228 rwm',
                'lxc.cgroup.devices.allow = c 10:232 rwm'
            ]);
        }

        Array.isArray(params['lxc-options']) && (this._conf = this._conf.concat(params['lxc-options']));
    },

    get id () {
        return this._node.id;
    },

    get lxcName () {
        return this.id;
    },

    start: function (opts, callback) {
        var conffile = path.join(this._node.workdir, 'lxc-config');
        var logfile  = path.join(this._node.workdir, 'lxc.log');
        var confile  = path.join(this._node.workdir, 'lxc.console');
        var upperdir = path.join(this._node.workdir, 'rootfs-overlay');

        flow.steps()
            .next(function (next) {
                mkdir(upperdir, next);
            })
            .next(function (next) {
                mkdir(this._mountpoint, next);
            })
            .next(function (next) {
                fs.writeFile(conffile, this._conf.join("\n"), next);
            })
            .next(function (next) {
                sh(this._logger,
                    'mount -t overlayfs -o upperdir=' + upperdir +
                    ',lowerdir=' + this._mount.mountpoint.path +
                    ' overlay ' + this._mountpoint,
                    next
                );
            })
            .next(function (next) {
                this._logger.debug('Container start: ' + this.lxcName);
                this._proc = spawn(process.env.SHELL || '/bin/sh', ['-c',
                        'lxc-start -n ' + this.lxcName +
                        ' -f ' + conffile +
                        ' -o ' + logfile +
                        ' -c ' + confile
                    ], {
                        cwd: this._node.workdir,
                        stdio: ['ignore', 'ignore', 'ignore']
                    });
                this._proc
                    .on('error', function (err) {
                        this._logger.logError(err, {
                            message: 'Container error: ' + err.message
                        });
                        this._cleanup('stopped');
                    }.bind(this))
                    .on('exit', function (code, signal) {
                        this._logger.debug('Container exit: ' + (code == null ? 'killed ' + signal : code));
                        this._proc.removeAllListeners();
                        delete this._proc;
                        this._cleanup('stopped');
                    }.bind(this));
                next();
            })
            .with(this)
            .run(function (err) {
                err ? this._cleanup(null, function () { callback(err); }) : callback();
            });
    },

    stop: function (opts, callback) {
        sh(this._logger, 'lxc-stop -n ' + this.lxcName, function () {
            this._cleanup(null, callback);
        }.bind(this));
    },

    dump: function () {
        return {
            name: this.lxcName,
            pid: this._proc ? this._proc.pid : undefined
        };
    },

    _cleanup: function (state, done) {
        if (this._proc) {
            this._logger.debug('Container terminate: ' + this.lxcName);
            this._proc.removeAllListeners();
            this._proc.kill('SIGTERM');
            delete this._proc;
        }
        sh(this._logger, 'umount ' + this._mountpoint, function () {
            state != null && this._monitor('state', state);
            done && done();
        }.bind(this));
    }
});

module.exports = function (data, node, info, callback) {
    flow.each(['lxc-version'])
        .do(exec)
        .run(function (err) {
            var interior;
            if (!err) {
                try {
                    interior = new Lxc(node, data.params, data.monitor, data.logger);
                } catch (e) {
                    err = e;
                }
            }
            callback(err, interior);
        });
};
