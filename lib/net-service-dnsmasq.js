var Class = require('js-class'),
    exec  = require('child_process').exec;

var Dnsmasq = Class({
    constructor: function (conf, network) {
        this.adapter = network.adapter.device.name;
    },

    'setup:dhcp': function () {

    },

    'setup:dns': function () {

    },

    'setup:gateway': function () {
        
    }
}, {
    statics: {
        create: function (conf, network, setupFn, callback) {
            exec('dnsmasq -v', function (err) {
                var svc;
                if (!err && network.adapter.device) {
                    svc = new Dnsmasq(conf, network);
                    svc['setup:' + setupFn]();
                    setupFn(svc);
                }
                callback(err, svc);
            });
        }
    }
});

module.exports = {
    dhcp: function (data, network, info, callback) {
        Dnsmasq.create(data, network, 'dhcp', callback);
    },

    dns: function (data, network, info, callback) {
        Dnsmasq.create(data, network, 'dns', callback);
    },

    gateway: function (data, network, info, callback) {
        Dnsmasq.create(data, network, 'gateway', callback);
    }
};
