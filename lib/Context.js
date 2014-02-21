var Class = require('js-class'),
    elements = require('evo-elements'),
    Logger  = elements.Logger;
    Objects = elements.Objects;

var Context = Class({
    constructor: function (config, logger) {
        this._objects = new Objects();
        this._objects.define({
            image:      require('./Image'),
            cluster:    require('./Cluster'),
            network:    require('./Network'),
            container:  require('./Container')
        });
        this._objects.context = this;

        this._config = config || {};
        this._logger = Logger.wrap(logger);
    },

    get config () {
        return this._config;
    },

    get logger () {
        return this._logger;
    },

    registerApi: function (app, prefix) {
        this._objects.restful(app, prefix);
    }
});

module.exports = Context;
