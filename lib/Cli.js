var Class  = require('js-class'),
    flow   = require('js-flow'),
    _      = require('underscore'),
    http   = require('http'),
    url    = require('url'),
    elements = require('evo-elements'),
    Config = elements.Config,
    Errors = elements.Errors;

var MODELS = {
    cluster: { },
    network: { refs: ['cluster'] },
    service: { refs: ['network'] },
    node: { refs: ['cluster', 'network'] }
};

var Cli = Class(elements.Cli, {
    constructor: function () {
        elements.Cli.prototype.constructor.call(this, 'cells');
        this._serverUri = 'http://localhost:3000';

        this.options
            .option('server', {
                type: 'string',
                default: this._serverUri,
                help: 'Server base URI',
                callback: function (val) {
                    this._serverUri = val;
                }.bind(this)
            })
        ;

        this._restCommand('list', 'GET', { list: true });
        this._restCommand('get', 'GET', { id: true });
        this._restCommand('create', 'POST', { prop: true, refs: true });
        this._restCommand('update', 'PUT', { prop: true, id: true });
        this._restCommand('delete', 'DELETE', { id: true });

        this.options.command('import')
            .option('FILE', {
                type: 'string',
                position: 1,
                required: true,
                help: 'The file (JSON or YAML) defines all objects'
            })
            .option('start', {
                type: 'boolean',
                flag: true,
                default: true,
                help: 'Start all nodes in cluster'
            })
            .callback(this._import.bind(this));
    },

    _restCommand: function (name, verb, opts) {
        opts || (opts = {});
        var cmd = this.options.command(name);
        var pos = 0;
        cmd.option('TYPE', {
                type: 'string',
                position: ++ pos,
                required: true,
                help: 'Object type: ' + Object.keys(MODELS).join(','),
                callback: function (val) {
                    if (!MODELS[val]) {
                        this.fatal(new Error('Invalid object type: ' + val));
                    }
                }.bind(this)
            });
        opts.list || cmd.option('ID', {
                type: 'string',
                position: ++ pos,
                required: true,
                help: 'Object ID'
            });
        opts.prop && cmd.option('PROP', {
                type: 'string',
                position: ++ pos,
                list: true,
                help: 'Define a property: name=value'
            });
        opts.refs && cmd.option('ref', {
                type: 'string',
                abbr: 'r',
                list: true,
                help: 'Add a reference: type:id'
            });
        cmd.callback(opts.callback || function (options) {
            var path = '/' + options.TYPE;
            opts.id && (path += '/' + options.ID);
            var data;
            if (!opts.list) {
                data = { id: options.ID };
            }
            if (opts.refs) {
                data.refs = {};
                options.ref && options.ref.forEach(function (ref) {
                    var index = ref.indexOf(':');
                    if (index > 0) {
                        var type = ref.substr(0, index);
                        var id = ref.substr(index + 1);
                        data.refs[type] || (data.refs[type] = []);
                        data.refs[type].push(id);
                    }
                });
            }
            if (options.PROP) {
                var args = [];
                options.PROP.forEach(function (prop) {
                    args.push('-D');
                    args.push(prop);
                });
                data.properties = new Config().parse(args).opts;
            }
            this._rest(verb, path, data, function (err, payload) {
                if (err) {
                    this.fatal(err);
                    return;
                } else if (typeof(payload) == 'string') {
                    this.logOut(payload);
                } else if (payload) {
                    this.logObject(payload);
                }
                this.success();
            }.bind(this));
        }.bind(this));
    },

    _rest: function (method, path, data, callback) {
        if (this.debugging) {
            this.logOut(this.lo(this.em(method) + ' ' + this._serverUri + path));
            data && this.logOut(this.lo(JSON.stringify(data)));
        }

        var parsedUrl = url.parse(this._serverUri + path);
        var options = {
            method: method,
            hostname: parsedUrl.hostname,
            port: isNaN(parsedUrl.port) ? undefined : parseInt(parsedUrl.port),
            path: parsedUrl.path,
            headers: {
                'content-type': 'application/json'
            }
        };
        var req = http.request(options, function (res) {
            if (this.debugging) {
                res.statusCode && this.logOut(this.lo(this.em(res.statusCode.toString())));
                for (var key in res.headers) {
                    this.logOut(this.lo(this.pad(key, 20) + ': ' + res.headers[key]));
                }
            }

            res.setEncoding('utf8');
            var payload = '';
            res.on('data', function (chunk) {
                payload += chunk;
            }).on('end', function () {
                if (payload.length == 0) {
                    payload = null;
                } else if (res.headers['content-type'] &&
                           res.headers['content-type'].match(/\/json(?!\w)/)) {
                    payload = JSON.parse(payload);
                }
                var err;
                res.statusCode >= 400 && (err = Errors.make('REQUESTFAIL', {
                    message: 'Request failed: ' + res.statusCode + (payload ? ' ' + payload : ''),
                    status: res.statusCode,
                    payload: payload
                }));
                callback(err, payload);
            }).on('error', callback);
        }.bind(this));
        req.on('error', callback);
        data && req.write(JSON.stringify(data));
        req.end();
    },

    _respHandler: function (next) {
        return function (err, payload) {
            if (!err && this.debugging) {
                if (typeof(payload) == 'string') {
                    this.logOut(payload);
                } else if (payload) {
                    this.logObject(payload);
                }
            }
            next(err);
        }.bind(this);
    },

    _importFn: function (type, payload) {
        return function (next) {
            this._rest('POST', '/' + type, payload, this._respHandler(next));
        }.bind(this);
    },

    _import: function (options) {
        var conf = Config.loadFileSync(options.FILE);
        var clusters = conf && Array.isArray(conf.clusters) ? conf.clusters : [];
        flow.each(clusters)
            .do('import:cluster')
            .with(this)
            .onsuccess(this.success)
            .onerror(this.fatal)
            .run(options);
    },

    logImport: function (type, id) {
        this.logAction(this.pad(type, 8), id);
    },

    'import:cluster': function (options, cluster, next) {
        this.logImport('CLUSTER', cluster.id);
        var payload = {
            id: cluster.id,
            properties: _.clone(cluster)
        };
        delete payload.properties.networks;
        delete payload.properties.nodes;
        delete payload.properties.id;

        var networks = Array.isArray(cluster.networks) ? cluster.networks : [];
        var nodes = Array.isArray(cluster.nodes) ? cluster.nodes : [];

        flow.steps()
            .next(this._importFn('cluster', payload))
            .next(function (next) {
                flow.each(networks)
                    .do('import:network')
                    .with(this)
                    .run(options, payload, next);
            })
            .next(function (next) {
                flow.each(nodes)
                    .do('import:node')
                    .with(this)
                    .run(options, payload, next);
            })
            .with(this)
            .run(next);
    },

    'import:network': function (options, cluster, network, next) {
        this.logImport('NETWORK', network.id);
        var payload = {
            id: cluster.id + '.' + network.id,
            refs: {
                cluster: [cluster.id]
            },
            properties: _.clone(network)
        };
        delete payload.properties.id;
        this._importFn('network', payload)(next);
    },

    'import:node': function (options, cluster, node, next) {
        this.logImport('NODE', node.id);
        var payload = {
            id: cluster.id + '.' + node.id,
            refs: {
                cluster: [cluster.id]
            },
            properties: _.clone(node)
        };
        delete payload.properties.id;
        delete payload.properties.nics;
        var networks = {};
        payload.properties.nics = (Array.isArray(node.nics) ? node.nics : []).map(function (nic) {
            if (typeof(nic) == 'string') {
                nic = { network: cluster.id + '.' + nic };
            } else {
                nic.network = cluster.id + '.' + nic.network;
            }
            networks[nic.network] = true;
            return nic;
        });
        payload.refs.network = Object.keys(networks);
        flow.steps()
            .next(this._importFn('node', payload))
            .next(function (next) {
                if (options.start) {
                    this.logImport('START', node.id);
                    this._rest('PUT', '/node/' + payload.id, { properties: { state: 'running' } }, this._respHandler(next));
                } else {
                    next();
                }
            })
            .with(this)
            .run(next);
    }
}, {
    statics: {
        run: function () {
            new Cli().run();
        }
    }
});

module.exports = Cli;
