var Class   = require('js-class'),
    plugins = require('js-plugins'),
    _       = require('underscore'),
    Logger = require('evo-elements').Logger;

function logPrefix(name, id, logName) {
    var prefix = '<' + name + '[' + id + ']';
    logName && (prefix += '.' + logName);
    return prefix + '> ';
}

var ManagementObject = Class({
    constructor: function (type, id, props, options) {
        this._context = options.container.context;
        this._type  = type;
        this._id    = id;
        this._props = props;
        this._logger = Logger.clone(this.context.logger, { prefix: logPrefix(type, id) });
        this._name = props.name;
        this.logger.debug('NEW-MO ' + id);
    },

    get context () {
        return this._context;
    },

    get config () {
        return this.context.config;
    },

    get logger () {
        return this._logger;
    },

    get properties () {
        return this._props;
    },

    get name () {
        return this._name;
    },

    pluginData: function (params, logName, extra) {
        return _.extend({
            params: params,
            config: this.context.config,
            logger: Logger.clone(this.context.logger, { prefix: logPrefix(this._type, this._id, logName) })
        }, extra || {});
    },

    get pluginErrorLogger () {
        return function (err, info) {
            this.logger.logError(err, {
                message: 'Plugin load error [' + info.extension + '/' + info.name + ']: ' + err.message
            });
        }.bind(this);
    },

    connectPlugin: function (extensionPoint, name, opts, callback) {
        if (typeof(opts) == 'function') {
            callback = opts;
            opts = {};
        }
        opts || (opts = {});
        plugins.connect(this, extensionPoint, {
            name: name,
            data: this.pluginData(opts.params || this.properties, name, opts.extra),
            required: opts.required,
            onerror: this.pluginErrorLogger
        }, callback);
    },

    dump: function () {
        return this.properties;
    },

    destruct: function (callback) {
        this.logger.debug('DEL-MO ' + this._id);
        callback();
    },

    dispose: function () {
        this.logger.debug('REL-MO' + this._id);
    }
});

module.exports = ManagementObject;
