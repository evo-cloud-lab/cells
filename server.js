#!/usr/bin/env node

var plugins  = require('js-plugins'),
    elements = require('evo-elements'),
    Config = elements.Config,
    Logger = elements.Logger,

    Server = require('./lib/Server');

var logger = new Logger('cells');

function logErrors(err) {
    if (err.code == 'ERRORS' && Array.isArray(err.errors)) {
        err.errors.forEach(logErrors);
    } else {
        logger.logError(err);
    }
}

function fatal(err) {
    logErrors(err);
    process.exit(1);
}

var server = new Server(Config.conf().opts, logger);

function initiateExit(code) {
    if (server.stop(function (err) {
        err ? fatal(err) : process.exit(code || 0);
    })) {
        logger.notice('Exiting ...');
        return true;
    }
    return false;
}

var count = 0;
function terminateByUser() {
    if (!initiateExit() && ++ count > 4) {
        logger.warn('Force exiting now!');
        process.exit(1);
    }
}

logger.notice('Scanning plugins ...');
plugins.instance.scan();

logger.notice('Starting API server ...');
var port = process.env.PORT || 3000;
server.start(port, function (err) {
    if (err) {
        fatal(err);
    } else {
        logger.notice('API server is ready on port ' + port);
    }
});

process.on('uncaughtException', function (err) {
    logger.fatal('UncaughtException: ' + err.message);
    logErrors(err);
    initiateExit(1);
});

process.on('SIGTERM', initiateExit);
process.on('SIGINT', terminateByUser);
