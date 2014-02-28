var Class = require('js-class'),
    flow  = require('js-flow'),
    fs    = require('fs'),
    path  = require('path'),
    mkdir = require('mkdirp'),
    exec  = require('child_process').exec,
    spawn = require('child_process').spawn,
    sh    = require('../lib/ShellExec').sh;

/*
var LxcWait = Class(process.EventEmitter, {
    constructor: function (lxc) {
        this._proc = exec('lxc-wait -n ' + lxc.id + ' RUNNING', function (err, stdout, stderr) {
            shlog(lxc._logger, stdout);
            shlog(lxc._logger, stderr, true);
            if (this._proc) {
                delete this._proc;
                if (this._timer) {
                    clearTimeout(this._timer);
                    delete this._timer;
                }
                this.emit('finish', err);
            }
        }.bind(this));
        this._timer = setTimeout(function () {
            delete this._timer;
            this._proc && this._proc.kill('SIGTERM');
            delete this._proc;
            this.emit('finish', new Error('timeout'));
        }.bind(this), 3000);
    },

    cancel: function (emit) {
        this._timer && clearTimeout(this._timer);
        delete this._timer;
        if (this._proc) {
            this._proc.kill('SIGTERM');
            delete this._proc;
            emit && this.emit('finish', new Error('aborted'));
        }
    }
});
*/

var Lxc = Class({
    constructor: function (node, data) {
        this._node    = node;
        this._logger  = node.logger;
        this._monitor = data.monitor;

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
            'lxc.utsname=' + (data.utsname || 'linux'),
            'lxc.devttydir=',
            'lxc.tty=' + (data.tty == null ? 4 : data.tty),
            'lxc.pts=' + (data.pts == null ? 1024 : data.pts),
            'lxc.cap.drop=sys_module mac_admin' + (data['drop-caps'] ? ' ' + data['drop-caps'] : '')
        ];
        var arch = data.arch || node.image.manifest.arch;
        arch && this._conf.push('lxc.arch=' + arch);
        var aaProfile = data['aa-profile'] || node.image.manifest['aa-profile'];
        aaProfile && this._conf.push('lxc.aa_profile=' + aaProfile);

        Array.isArray(data.nics) && data.nics.forEach(function (nic) {
            var connectivity = typeof(nic) == 'string' ? { network: nic } : nic;
            var network = node.network(connectivity.network);
            if (!network) {
                throw new Error('Network not found: ' + connectivity.network);
            }
            this._conf.push('lxc.network.type=veth');
            this._conf.push('lxc.network.flags=up');
            network.adapter.device && this._conf.push('lxc.network.link=' + network.adapter.device);
            if (!isNaN(nic['address-index'])) {
                var address = network.addressAt(nic['address-index']);
                if (!address) {
                    throw new Error('Network address invalid: ' + nic['address-index'] + ' in ' + network.name);
                } else {
                    this._conf.push('lxc.network.hwaddr=' + address.mac);
                    this._conf.push('lxc.network.ipv4=' + address.ip);
                }
            }
        }, this);

        if (!data['no-default-cgroup']) {
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

        Array.isArray(data['lxc-options']) && (this._conf = this._conf.concat(data['lxc-options']));

        this._state = 'stopped';
    },

    get id () {
        return this._node.id;
    },

    start: function (opts) {
        if (this._state == 'stopped') {
            this._startContainer();
        }
    },

    stop: function (opts) {
        if (this._state == 'starting') {
            this._state = 'stopping';
            if (this._wait) {
                this._wait.cancel(true);
                delete this._wait;
            }
            if (this._proc) {
                this._proc.kill('SIGTERM');
            }
        } else if (this._state == 'running') {
            this._state = 'stopping';
            exec('lxc-stop -n ' + this.id, function () { });
        }
    },

    _startContainer: function () {
        this._monitor('state', this._state = 'starting');

        var conffile = path.join(this._node.workdir, 'lxc-config');
        var logfile  = path.join(this._node.workdir, 'lxc.log');
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
                if (this._state == 'starting') {
                    this._proc = spawn(process.env.SHELL || '/bin/sh', ['-c',
                            'lxc-start -n ' + this.id + ' -f ' + conffile + ' -o ' + logfile
                        ], {
                            cwd: this._node.workdir,
                            stdio: ['ignore', 'ignore', 'ignore']
                        });
                    this._proc
                        .on('error', function (err) {
                            this._logger.error('Container Process Error: ' + err.message);
                        }.bind(this))
                        .on('exit', this.onContainerExit.bind(this));
                    next();
                } else {
                    next(new Error('aborted'));
                }
            })
            .with(this)
            .run(flow.Try.br(function () {
                this._monitor('state', this._state = 'running');
            }, function (err) {
                if (this._proc) {
                    this._proc.removeAllListeners();
                    this._proc.kill('SIGTERM');
                    delete this._proc;
                }
                this._cleanup();
            }));
    },

    onContainerExit: function (code, signal) {
        delete this._proc;
        this._cleanup();
    },

    _cleanup: function () {
        exec('umount ' + this._mountpoint, function () {
            this._monitor('state', this._state = 'stopped');
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
                    interior = new Lxc(node, data);
                } catch (e) {
                    err = e;
                }
            }
            callback(err, interior);
        });
};
