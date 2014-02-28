var Class = require('js-class'),
    spawn = require('child_process').spawn,
    log   = require('./ShellExec').log;

var ShellService = Class({
    constructor: function (data, network) {
        this._network = network;
        this.logger = data.logger;
    },

    get network () {
        return this._network;
    },

    get cluster () {
        return this.network.cluster;
    },

    start: function (callback) {
        this._prog = spawn(process.env.SHELL || '/bin/sh', ['-c', this.command], {
            cwd: this.cluster.workdir
        });
        this._prog
            .on('error', this.onError.bind(this))
            .on('exit', this.onExit.bind(this));
        this._prog.stdout.on('data', this._logStdout.bind(this));
        this._prog.stderr.on('data', this._logStderr.bind(this));
        callback();
    },

    stop: function (callback) {
        if (this._prog) {
            if (this._notifiers) {
                this._notifiers.push(callback);
            } else {
                this._prog.kill('SIGTERM');
                this._notifiers = [callback];
                this._stopTimer = setTimeout(function () {
                    delete this._stopTimer;
                    this._prog.kill('SIGKILL');
                }.bind(this), 1000);
            }
        } else {
            callback();
        }
    },

    onError: function (err) {
        delete this._prog;
        this.logger.err('Process error: ' + err.message);
    },

    onExit: function (code, signal) {
        if (this._stopTimer) {
            clearTimeout(this._stopTimer);
            delete this._stopTimer;
        }
        var notifiers = this._notifiers;
        delete this._notifiers;
        delete this._prog;
        this.logger.debug('Process terminated: ' + (code == null ? 'killed ' + signal : code));
        Array.isArray(notifiers) && notifiers.forEach(function (notifier) {
            notifier();
        });
    },

    _logStdout: function (data) {
        log(this.logger, data);
    },

    _logStderr: function (data) {
        log(this.logger, data, true);
    }
});

module.exports = ShellService;
