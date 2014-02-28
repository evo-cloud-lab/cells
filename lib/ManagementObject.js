var Class = require('js-class'),
    _     = require('underscore'),
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
