var Class = require('js-class'),
    exec  = require('child_process').exec;
    shell = require('../lib/ShellExec').shell;

var NATRules = Class({
    constructor: function (data, service) {
        this.logger = data.logger;
        var subnet = service.network.subnet;
        if (!subnet) {
            throw new Error('Subnet unavailable');
        }
        var network = subnet.toString();
        this.rule = 'POSTROUTING -s ' + network + ' ! -d ' + network + ' -j MASQUERADE';
    },

    start: function (callback) {
        shell(this.logger).sh('iptables -t nat -A ' + this.rule).run(callback);
    },

    stop: function (callback) {
        shell(this.logger).sh('iptables -t nat -D ' + this.rule).run(callback);
    },

    dump: function () {
        return {
            rules: [this.rule]
        };
    }
});

module.exports = {
    ServiceClass: NATRules,

    nat: function (data, service, info, callback) {
        exec('iptables -V', function (err) {
            var svc;
            if (!err && service.network.subnet) {
                try {
                    svc = new NATRules(data, service);
                } catch (e) {
                    err = e;
                }
            }
            callback(err, svc);
        });
    }
};
