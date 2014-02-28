var Class   = require('js-class'),
    flow    = require('js-flow'),
    http    = require('http'),
    express = require('express'),
    plugins = require('js-plugins'),
    elements = require('evo-elements'),
    Config = elements.Config,
    Logger = elements.Logger,

    Context = require('./Context');

var Server = Class({
    constructor: function (config, logger) {
        this.config = config;
        this.logger = Logger.wrap(logger);

        this.context = new Context(config, this.logger);

        var app = express();

        app.use(express.json());
        app.use(express.urlencoded());
        app.use(app.router);

        this.app = app;

        this.context.registerApi(app);
    },

    start: function (port, callback) {
        this.server = http.createServer(this.app);
        this.server.listen(port, callback);
        return this;
    },

    stop: function (callback) {
        if (!this.stopping) {
            this.stopping = true;
            this.server.close();
            flow.steps()
                .next(this.context.destroyAll.bind(this.context))
                .aggregateErrors()
                .with(this)
                .run(callback);
            return true;
        }
        return false;
    }
});

module.exports = Server;
