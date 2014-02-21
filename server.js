#!/usr/bin/env node

var express = require('express'),
    plugins = require('js-plugins'),
    elements = require('evo-elements'),
    Config = elements.Config,
    Logger = elements.Logger,
    Context = require('./lib/Context');

var context = new Context(Config.conf().opts, new Logger('cells'));

var app = express();

app.use(express.json());
app.use(express.urlencoded());
app.use(app.router);

context.registerApi(app);

context.logger.info('Scanning plugins ...');
plugins.instance.scan();

context.logger.info('Starting API server ...');
var port = process.env.PORT || 3000;
app.listen(port, function (err) {
    if (err) {
        context.logger.error(err.message);
        process.exit(1);
    } else {
        context.logger.info('API server is ready on port ' + port);
    }
});
