var Class = require('js-class'),
    exec  = require('child_process').exec;
    shell = require('../lib/ShellExec').shell;

var NATRules = Class({
    constructor: function (data, network) {
        this.logger = data.logger;
        var subnet = network.subnet.base + '/' + network.subnet.bitmask;
        this.rule = 'POSTROUTING -s ' + subnet + ' ! -d ' + subnet + ' -j MASQUERADE';
    },

    start: function (callback) {
        shell(this.logger).sh('iptables -t nat -A ' + this.rule).run(callback);
    },

    stop: function (callback) {
        shell(this.logger).sh('iptables -t nat -D ' + this.rule).run(callback);
    }
});

module.exports = {
    nat: function (data, network, info, callback) {
        exec('iptables -V', function (err) {
            var svc;
            if (!err && network.adapter.device) {
                svc = new NATRules(data, network);
            }
            callback(err, svc);
        });
    }
};
