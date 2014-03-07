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
        this.logger.debug('[MGMTOBJ.NEW] ' + id);
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
                level: 'warning',
                message: '[PLUGIN.SKIP] ' + info.extension + '/' + info.name + ': ' + err.message
            });
        }.bind(this);
    },

    connectPlugin: function (extensionPoint, name, opts, callback) {
        if (typeof(opts) == 'function') {
            callback = opts;
            opts = {};
        }
        opts || (opts = {});
        this.logger.verbose('[PLUGIN.FIND] ' + extensionPoint + (name ? '/' + name : ''));
        plugins.connect(this, extensionPoint, {
            name: name,
            data: this.pluginData(opts.params || this.properties, name, opts.extra),
            required: opts.required,
            onerror: this.pluginErrorLogger
        }, function (err, instance, name) {
            !err && this.logger.verbose('[PLUGIN.LOAD] ' +
                                        extensionPoint + '/' +
                                        (Array.isArray(name) ? '[' + name.join(',') + ']' : name));
            callback(err, instance);
        }.bind(this));
    },

    dump: function () {
        return this.properties;
    },

    destruct: function (callback) {
        (this._destruct ? this._destruct : function (callback) { callback(); }).call(this, function () {
            this.logger.debug('[MGMTOBJ.DEL] ' + this._id);
            callback();
        }.bind(this));
    }
});

module.exports = ManagementObject;
