var Class = require('js-class'),
    flow  = require('js-flow'),
    path  = require('path'),
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
            service:    require('./Service'),
            node:       require('./Node')
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
    },

    createObject: function (id, modelName, refIds, props, callback) {
        this._objects.create(id, modelName, refIds, props, callback);
    },

    loadImage: function (image, callback) {
        var props = {};
        if (typeof(image) == 'string' && image.length > 0) {
            props.name = image;
            props.dir = path.resolve(this.config['imagedir'], image);
        } else if (typeof(image) == 'object') {
            props.name = image.name;
            props.dir = image.dir;
        }
        if (!props.name || !props.dir) {
            callback(Errors.badParam('image'));
        } else {
            var obj = this._objects.find('image', props.name);
            if (obj) {
                callback(null, obj);
            } else {
                this.createObject(props.name, 'image', {}, props, callback);
            }
        }
    }
});

module.exports = Context;
