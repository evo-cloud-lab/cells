var Class = require('js-class'),
    exec  = require('child_process').exec,

    ShellService = require('../lib/ShellService');

var Dnsmasq = Class(ShellService, {
    constructor: function (data, network) {
        ShellService.prototype.constructor.call(this, data, network);
        var conf = data.params;
        this.options = [
            conf.debug ? '-d' : '--keep-in-foreground',
            '--interface=' + network.adapter.device.name,
            '--except-interface=lo',
            '--bind-interfaces',
            '--strict-order',
            '--conf-file=',
            '--leasefile-ro',
            '--dhcp-no-override'
        ];
        conf['authoritative'] === false || this.options.push('--dhcp-authoritative');
        var staticIps = conf['static'];
        if (typeof(staticIps) == 'object' && staticIps.start && staticIps.count) {
            for (var i = 0; i < staticIps.count; i ++) {
                var address = network.addressAt(staticIps.start + i);
                address && this.options.push('--dhcp-host=' + address.mac + ',' + address.ip);
            }
        }
        var dynamicIps = conf['dynamic'];
        typeof(dynamicIps) == 'object' || (dynamicIps = {});
        isNaN(dynamicIps.start) && (dynamicIps.start = 0);
        isNaN(dynamicIps.count) && (dynamicIps.count = network.addressCount - dynamicIps.start);
        if (dynamicIps.count > 0) {
            this.options.push('--dhcp-range=' + network.addressAt(dynamicIps.start).ip + ',' +
                                                network.addressAt(dynamicIps.start + dynamicIps.count - 1).ip);
        }
        Array.isArray(conf['arguments']) && (this.options = this.options.concat(conf['arguments']));
        this.command = 'dnsmasq ' + this.options.join(' ');
    }
});

module.exports = function (data, network, info, callback) {
    exec('dnsmasq -v', function (err) {
        var svc;
        if (!err && network.adapter.device) {
            svc = new Dnsmasq(data, network);
        }
        callback(err, svc);
    });
};
