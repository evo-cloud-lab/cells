var Class = require('js-class'),
    _     = require('underscore'),
    Logger = require('evo-elements').Logger;

function logPrefix(name, id, logName) {
    var prefix = '<' + name + '[' + id + ']';
    logName && (prefix += '.' + logName);
    return prefix + '> ';
}

var ManagementObject = Class({
    constructor: function (name, id, props, options) {
        this._context = options.container.context;
        this._name = name;
        this._props = props;
        this._logger = Logger.clone(this.context.logger, { prefix: logPrefix(name, id) });
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

    pluginData: function (params, logName, extra) {
        return _.extend({
            params: params,
            config: this.context.config,
            logger: Logger.clone(this.context.logger, { prefix: logPrefix(this.name, this.id, logName) })
        }, extra || {});
    },

    dump: function () {
        return this.properties;
    },

    destruct: function (callback) {
        this.logger.debug('DEL-MO ' + this.id);
        callback();
    },

    dispose: function () {
        this.logger.debug('REL-MO' + this.id);
    }
});

module.exports = ManagementObject;
