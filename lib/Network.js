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
    _       = require('underscore'),
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

var Subnets = Class({
    constructor: function (conf) {
        typeof(conf) == 'object' || (conf = {});
        this._subnets = conf['subnets'];
        Array.isArray(this._subnets) || (this._subnets = ['172.16.0.0/12,24', '192.168.0.0/16,24']);
        this._reserves = parseInt(conf['reserved-ips']) || 9;
        this._macPrefix = conf['mac-prefix'] || '80:00:';
        this._allocates = {};
    },

    get reservedIps () {
        return this._reserves;
    },

    get macPrefix () {
        return this._macPrefix;
    },

    allocate: function (opts) {
        var selected;
        if (this._subnets.some(function (subnet) {
                var params  = subnet.split(',');
                var base    = new netmask.Netmask(params[0]);
                var baseInt = netmask.ip2long(base.base);
                var bits = parseInt(params[1]);
                var size = 1 << (bits - base.bitmask);
                for (var n = 0; n < size; n ++) {
                    var subnetInt = baseInt + (n << (32 - bits));
                    if (!this._allocates[subnetInt]) {
                        selected = new netmask.Netmask(netmask.long2ip(subnetInt) + '/' + bits);
                        if (!networkInUse(selected)) {
                            this._allocates[subnetInt] = selected;
                            return true;
                        }
                    }
                }
                return false;
            }, this)) {
            selected.release = (function (pool, subnet) {
                return function () { pool.release(subnet); };
            })(this, selected);
            return this.create(selected, opts);
        }
        return null;
    },

    release: function (subnet) {
        if (subnet && subnet.base) {
            var key = netmask.ip2long(subnet.base);
            delete this._allocates[key];
        }
    },

    create: function (subnet, opts) {
        var pool = this;
        var macPrefix = opts && opts['mac-prefix'] || pool.macPrefix;

        subnet.addressAt = function (index, reserved) {
            if (reserved === true || reserved == 'reserved') {
                if (index < 0) {
                    index += pool.reservedIps;
                }
                if (index < 0 || index >= pool.reservedIps) {
                    return null;
                }
            } else {
                if (index < 0) {
                    index += subnet.size - 2;
                } else {
                    index += pool.reservedIps;
                }
                if (index < pool.reservedIps || index >= subnet.size - 2) {
                    return null;
                }
            }
            var ipVal = netmask.ip2long(subnet.base) + 1 + index;
            return {
                ip: netmask.long2ip(ipVal),
                mac: macPrefix + ip2mac(ipVal)
            };
        };

        subnet.dump = function () {
            return {
                network:    subnet.base,
                netmask:    subnet.mask,
                broadcast:  subnet.broadcast,
                maskbits:   subnet.bitmask,
                size:       subnet.size,
                reserved:   subnet.reserved,
                addresses:  subnet.addresses,
                macbase:    macPrefix + ip2mac(0),
                host:  _.pick(subnet.host, 'ip', 'mac'),
                first: _.pick(subnet.first, 'ip', 'mac'),
                last:  _.pick(subnet.last, 'ip', 'mac')
            };
        };

        Object.defineProperties(subnet, {
            macPrefix:  { value: macPrefix, enumerable: true },
            reserved:   { value: pool.reservedIps, enumerable: true },
            addresses:  { value: subnet.size - pool.reservedIps - 2, enumerable: true },
            host:  { value: subnet.addressAt(0, 'reserved'), enumerable: true },
            first: { value: subnet.addressAt(0), enumerable: true },
            last:  { value: subnet.addressAt(-1), enumerable: true }
        });

        return subnet;
    }
}, {
    statics: {
        pool: function (conf) {
            if (!Subnets._instance) {
                Subnets._instance = new Subnets(conf);
            }
            return Subnets._instance;
        }
    }
});

var Network = Class(ManagementObject, {
    constructor: function (cluster, id, props, options) {
        ManagementObject.prototype.constructor.call(this, 'network', id, props, options);
        this._cluster = cluster;
        this._subnets = Subnets.pool(this.config['network']);
    },

    get cluster () {
        return this._cluster;
    },

    get provider () {
        return this._provider;
    },

    get subnet () {
        return this.provider.subnet;
    },

    get device () {
        return this.provider.device;
    },

    setup: function (callback) {
        this.connectPlugin(
            'cells:network.provider',
            this.properties.provider,
            { required: true, extra: { subnets: this._subnets } },
            function (err, provider) {
                if (!err) {
                    this._provider = provider;
                }
                callback(err);
            }.bind(this)
        );
    },

    dump: function () {
        var subnet = this.subnet;
        return {
            subnet: subnet ? subnet.dump() : undefined,
            provider: _.extend({ name: this.provider.name },
                               typeof(this.provider.dump) == 'function' ? this.provider.dump() : {})
        };
    },

    _destruct: function (callback) {
        this.provider.destroy(callback);
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
