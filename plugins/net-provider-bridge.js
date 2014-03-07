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
    shell = require('../lib/ShellExec').shell,

    DhcpService = require('./net-service-dnsmasq').ServiceClass,
    NatService  = require('./net-service-iptables').ServiceClass;

var NetworkProvider = Class({
    constructor: function (data, network) {
        this.network = network;
        this.logger  = data.logger;
        this.subnets = data.subnets;

        this._ifPrefix = data.config['bridge-prefix'] || 'br';
        this._params = data.params;
        this._services = {};
    },

    get subnet () {
        return this._subnet;
    },

    get device () {
        return {
            type: 'bridge',
            name: this._ifname,
            address: this._hostIp
        };
    },

    setup: function (done) {
        flow.steps()
            .next('setup:subnet')
            .next('setup:bridge')
            .next('setup:dhcp')
            .next('setup:nat')
            .with(this)
            .run(function (err) {
                if (err) {
                    this.logger.logError(err);
                    this.destroy(function () {
                        done(err);
                    });
                } else {
                    done();
                }
            });
    },

    dump: function () {
        var services = {};
        for (var name in this._services) {
            var svc = this._services[name];
            if (typeof(svc.dump) == 'function') {
                services[name] = svc.dump();
            }
        }
        return {
            device: this.device,
            services: services
        };
    },

    destroy: function (done) {
        flow.steps()
            .ignoreErrors()
            .next('destroy:nat')
            .next('destroy:dhcp')
            .next('destroy:bridge')
            .next('destroy:subnet')
            .with(this)
            .run(done);
    },

    'setup:subnet': function (done) {
        this._subnet  = this.subnets.allocate(this._params);
        if (!this._subnet) {
            done(Errors.unavail('subnet'));
        } else {
            this.logger.info('SUBNET: ' + this._subnet.toString());
            done();
        }
    },

    'destroy:subnet': function (done) {
        if (this._subnet) {
            this._subnet.release();
            delete this._subnet;
        }
        done();
    },

    'setup:bridge': function (done) {
        if (this._params['host-ip'] !== false) {
            this._hostIp = this._subnet.host;
        }
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
                            (this._hostIp ? this._hostIp.ip + ' netmask ' + this._subnet.mask : '') + ' up')
                    .with(this)
                    .run(done);
            });
    },

    'destroy:bridge': function (done) {
        shell(this.logger)
            .sh('ifconfig ' + this._ifname + ' down')
            .sh('brctl delbr ' + this._ifname)
            .ignoreErrors()
            .with(this)
            .run(done);
    },

    'setup:dhcp': function (done) {
        var enabled = this._params.type == 'nat' || this._params.dhcp;
        if (enabled) {
            var params = this._params.dhcp || {};
            typeof(params) == 'object' || (params = {});
            if (!params.disabled) {
                this._startService('dhcp', DhcpService, params, done);
                return;
            }
        }
        done();
    },

    'destroy:dhcp': function (done) {
        this._stopService('dhcp', done);
    },

    'setup:nat': function (done) {
        if (this._params.type == 'nat') {
            this._startService('nat', NatService, this._params, done);
        } else {
            done();
        }
    },

    'destroy:nat': function (done) {
        this._stopService('nat', done);
    },

    _startService: function (name, serviceClass, params, done) {
        var err, svc;
        try {
            svc = new serviceClass({
                logger: this.logger,
                params: params
            }, {
                network: {
                    subnet: this.subnet,
                    device: this.device,
                    cluster: this.network.cluster
                }
            });
        } catch(e) {
            err = e;
        }

        if (!err && svc) {
            svc.start(function (err) {
                !err && (this._services[name] = svc);
                done(err);
            }.bind(this));
        } else {
            done(err);
        }
    },

    _stopService: function (name, done) {
        var svc = this._services[name];
        if (svc) {
            svc.stop(function (err) {
                delete this._services[name];
                done(err);
            }.bind(this));
        } else {
            done();
        }
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
            var provider;
            if (!err) {
                try {
                    provider = new NetworkProvider(data, network);
                } catch (e) {
                    err = e;
                }
            }
            provider ? provider.setup(function (err) {
                callback(err, provider);
            }) : callback(err);
        });
};
