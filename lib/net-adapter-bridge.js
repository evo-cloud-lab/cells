/** @fileoverview
 * Network extension for managing local bridge based network
 *
 * Configurations:
 * - bridge-prefix: String, default 'br'
 *     prefix of created bridge device name
 *
 * Options:
 * - host-ip: Boolean, default: true
 *     when true, first IP is assigned to host (bridge), or no IP is assigned to host.
 */

var Class = require('js-class'),
    flow  = require('js-flow'),
    fs    = require('fs'),
    path  = require('path'),
    exec  = require('child_process').exec,
    idgen = require('idgen');

var Adapter = Class({
    constructor: function (data, network) {
        this.network = network;
        this.logger = data.logger;
        this._ifPrefix = data.config['bridge-prefix'] || 'br';
        this._hostIp = network.reservedAddress(0);
        if (data.params['host-ip'] === false) {
            delete this._hostIp;
        }
    },

    setup: function (done) {
        flow.loop()
            .do(function (next) {
                this._ifname = this._ifPrefix + idgen();
                next();
            })
            .while(function (next) {
                fs.exists(path.join('/sys/devices/virtual/net', this._ifname), next);
            })
            .with(this)
            .run(function () {
                this._cmds([
                    'brctl addbr ' + this._ifname,
                    'ifconfig ' + this._ifname + ' ' +
                            (this._hostIp ? this._hostIp.ip + ' netmask ' + this.network.subnet.mask : '') + ' up'
                ], false, done);
            });
    },

    device: function () {
        return {
            name: this._ifname,
            address: this._hostIp
        };
    },

    destroy: function (done) {
        this._cmds([
            'ifconfig ' + this._ifname + ' down',
            'brctl delbr ' + this._ifname
        ], true, done);
    },

    _cmds: function (cmds, ignoreErrors, done) {
        var f = flow.steps();
        ignoreErrors && f.ignoreErrors();
        cmds.forEach(function (cmd) { f.next(this._sh(cmd)); }, this);
        f.with(this).run(done);
    },

    _sh: function (cmd) {
        var self = this;
        return function (next) {
            self.logger.debug('EXEC ' + cmd);
            exec(cmd, function (err, stdout, stderr) {
                stdout && stdout.split("\n").forEach(function (line) {
                    self.logger.debug('[STDOUT] ' + line);
                });
                stderr && stderr.split("\n").forEach(function (line) {
                    self.logger.error('[STDERR] ' + line);
                });
                next(err);
            });
        };
    }
});


module.exports = function (data, network, info, callback) {
    flow.each(['ifconfig', 'brctl show'])
        .do(function (cmd, next) {
            exec(cmd, function (err) {
                next(err);
            });
        })
        .run(function (err) {
            callback(err, err ? null : new Adapter(data, network));
        });
};
