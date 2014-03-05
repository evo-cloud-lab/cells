/** @fileoverview
 * Network Management Object
 *
 * Configurations:
 * - reserved-subnets: Array, default: ['172.16.0.0/12,24', '192.168.0.0/16,24']
 *     defines the ranges where a subnet can be chosen from
 * - reserved-ips: Integer, default: 9
 *     number of IPs that are reserved for internal use, usually xxx.1 - xxx.9
 *
 * Options:
 * - mac-base: HexString, default: 80:PID-H:PID-L:00:00:00
 *     base MAC addresses for mapping to IP addresses
 * - adapter: Hash, default: {}
 *     adapter options, 'name' is used to find the extension
 * - services: Array, default: []
 *     list of services, each is a Hash at least contains 'id' and 'role'
 */

var Class   = require('js-class'),
    flow    = require('js-flow'),
    plugins = require('js-plugins'),
    netmask = require('netmask'),
    os      = require('os'),
    Errors  = require('evo-elements').Errors,

    ManagementObject = require('./ManagementObject');

function networkInUse(subnet) {
    var ifs = os.networkInterfaces();
    for (var name in ifs) {
        if (ifs[name].some(function (network) {
            return network.family == 'IPv4' && subnet.contains(network.address);
        })) {
            return true;
        }
    }
    return false;
}

function findUnusedSubnet(subnets) {
    var selected;
    if (subnets.some(function (subnet) {
            var params = subnet.split(',');
            var base = new netmask.Netmask(params[0]);
            var baseInt = netmask.ip2long(base.base);
            var bits = parseInt(params[1]);
            var size = 1 << (bits - base.bitmask);
            for (var n = 0; n < size; n ++) {
                selected = new netmask.Netmask(netmask.long2ip(baseInt + (n << (32 - bits))) + '/' + bits);
                if (!networkInUse(selected)) {
                    return true;
                }
            }
            return false;
        }, this)) {
        return selected;
    }
    return null;
}

function ip2mac(ipVal) {
    var str = '';
    for (var i = 0; i < 4; i ++) {
        var v = (ipVal >> ((3 - i) << 3)) & 0xff;
        i > 0 && (str += ':');
        v = [(v >> 4) & 0xf, v & 0xf];
        for (var n = 0; n < 2; n ++) {
            str += String.fromCharCode(v[n] + (v[n] > 9 ? 87 : 48));
        }
    }
    return str;
}

var Network = Class(ManagementObject, {
    constructor: function (cluster, id, props, options) {
        ManagementObject.prototype.constructor.call(this, 'network', id, props, options);

        this._cluster = cluster;

        this._subnets = this.config['reserved-subnets'];
        Array.isArray(this._subnets) || (this._subnets = ['172.16.0.0/12,24', '192.168.0.0/16,24']);
        this._reserves = parseInt(this.config['reserved-ips']) || 9;

        this._macPrefix = props['mac-prefix'] || '80:00:';

        this._adapterConf = props['adapter'] || {};
        typeof(this._adapterConf) == 'string' && (this._adapterConf = { name: this._adapterConf });
    },

    get cluster () {
        return this._cluster;
    },

    get subnet () {
        return this._subnet;
    },

    get addressCount () {
        return this._subnet.size - this._reserves - 2;
    },

    get reservedCount () {
        return this._reserves;
    },

    reservedAddress: function (index) {
        if (index >= 0 && index < this._reserves) {
            return this._addressAt(index);
        }
        return null;
    },

    addressAt: function (index) {
        return this._addressAt(index + this._reserves);
    },

    get adapter () {
        return this._adapter;
    },

    setup: function (callback) {
        flow.steps()
            .next('setup:subnet')
            .next('setup:adapter')
            .with(this)
            .run(callback);
    },

    dump: function () {
        return {
            subnet: this._subnet ? function () {
                    return {
                        network: this._subnet.base,
                        netmask: this._subnet.mask,
                        reserved: this.reservedCount
                    };
                }.bind(this) : null,
            macbase: this._addressAt(0).mac,
            adapter: typeof(this._adapter.dump) == 'function' ? this._adapter.dump() : undefined
        };
    },

    destruct: function (callback) {
        flow.steps()
            .ignoreErrors()
            .next(this._adapter.destroy.bind(this._adapter))
            .next(ManagementObject.prototype.destruct.bind(this))
            .run(callback);
    },

    _addressAt: function (index) {
        if (index >= 0 && index < this._subnet.size - 2) {
            var ipVal = netmask.ip2long(this._subnet.base) + 1 + index;
            return {
                ip: netmask.long2ip(ipVal),
                mac: this._macPrefix + ip2mac(ipVal)
            };
        }
        return null;
    },

    'setup:subnet': function (done) {
        this.logger.debug('FIND-SUBNET');
        this._subnet = findUnusedSubnet(this._subnets);
        this.logger.info('SUBNET: %j', this._subnet);
        done(this._subnet ? null : Errors.unavail('subnet'));
    },

    'setup:adapter': function (done) {
        flow.steps().chain()
            .next(function (next) {
                this.logger.debug('LOAD-ADAPTER');
                plugins.connect(this, 'cells:network.adapter', {
                    name: this._adapterConf.name,
                    data: this.pluginData(this._adapterConf, this._adapterConf.name),
                    required: true
                }, next);
            })
            .next(function (adapter, next) {
                this.logger.debug('SETUP-ADAPTER');
                (this._adapter = adapter).setup(next);
            })
            .with(this)
            .run(done);
    }
});

module.exports = {
    exports: 'CRUD',

    refs: ['cluster'],

    create: function (id, props, refObjs, options, callback) {
        var network = new Network(refObjs.cluster[0], id, props, options);
        network.setup(function (err) {
            callback(err, network);
        });
    }
};
