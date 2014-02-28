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
    idgen = require('idgen'),
    shell = require('../lib/ShellExec').shell;

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
                shell(this.logger)
                    .sh('brctl addbr ' + this._ifname)
                    .sh('ifconfig ' + this._ifname + ' ' +
                            (this._hostIp ? this._hostIp.ip + ' netmask ' + this.network.subnet.mask : '') + ' up')
                    .run(done);
            });
    },

    get device () {
        return {
            name: this._ifname,
            address: this._hostIp
        };
    },

    destroy: function (done) {
        shell(this.logger)
            .sh('ifconfig ' + this._ifname + ' down')
            .sh('brctl delbr ' + this._ifname)
            .ignoreErrors()
            .run(done);
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
