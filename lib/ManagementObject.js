var Class = require('js-class'),
    Logger = require('evo-elements').Logger;

var ManagementObject = Class({
    constructor: function (name, id, props, options) {
        this._context = options.container.context;
        this._name = name;
        this._props = props;
        this._logger = Logger.clone(this.context.logger, { prefix: '<' + name + '> ' });
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

    pluginData: function (params, logName) {
        return {
            params: params,
            config: this.context.config,
            logger: logName ? Logger.clone(this.context.logger, { prefix: '<' + this._name + '.' + logName + '> ' }) : this.logger
        };
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
