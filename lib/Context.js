var Class = require('js-class'),
    flow  = require('js-flow'),
    elements = require('evo-elements'),
    Logger  = elements.Logger;
    Objects = elements.Objects
    Errors  = elements.Errors;

var Context = Class({
    constructor: function (config, logger) {
        this._config = config || {};
        this._logger = Logger.wrap(logger);

        this._objects = new Objects();
        this._objects.define({
            image:      require('./Image'),
            cluster:    require('./Cluster'),
            network:    require('./Network'),
            container:  require('./Container')
        });
        this._objects.context = this;
    },

    get config () {
        return this._config;
    },

    get logger () {
        return this._logger;
    },

    registerApi: function (app, prefix) {
        this._objects.restful(app, prefix);
    },

    destroyAll: function (callback) {
        flow.each(this._objects.rootObjects.names)
            .do(function (name, next) {
                var objs = this._objects.rootObjects.all(name) || {};
                flow.each(objs)
                    .do('&destroy')
                    .aggregateErrors()
                    .run({ recursive: true }, function (errs) {
                        next(errs ? Errors.aggregate(errs) : null);
                    });
            })
            .aggregateErrors()
            .with(this)
            .run(function (errs) {
                callback(errs ? (function () {
                        var errors = [];
                        errs.forEach(function (err) {
                            errors = errors.concat(err.errors);
                        });
                        return Errors.aggregate(errors);
                    })() : null);
            });
        return this;
    }
});

module.exports = Context;
