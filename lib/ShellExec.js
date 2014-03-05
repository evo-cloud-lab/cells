var Class  = require('js-class'),
    Steps  = require('js-flow').Steps,
    Logger = require('evo-elements').Logger,
    exec   = require('child_process').exec;

var ShellExec = Class(Steps, {
    constructor: function (logger) {
        Steps.prototype.constructor.call(this);
        this.logger = Logger.wrap(logger);
    },

    sh: function (cmdline) {
        this.next(function (next) {
            ShellExec.sh(this.logger, cmdline, next);
        }.bind(this));
        return this;
    }
}, {
    statics: {
        shell: function (logger) {
            return new ShellExec(logger);
        },

        log: function (logger, content, stderr) {
            var prefix = stderr ? '[STDERR] ' : '[STDOUT] ';
            content && content.split("\n").forEach(function (line) {
                logger.debug(prefix + line);
            });
        },
        sh: function (logger, cmdline, opts, callback) {
            if (typeof(opts) == 'function') {
                callback = opts;
                opts = {};
            }
            logger.debug('[SHELL.CMD] ' + cmdline);
            exec(cmdline, opts || {}, function (err, stdout, stderr) {
                ShellExec.log(logger, stdout);
                ShellExec.log(logger, stderr, true);
                err ? logger.debug('[SHELL.RET] ' + (err.code == null ? 'killed ' + err.signal : err.code))
                    : logger.debug('[SHELL.OK]');
                callback(err, stdout, stderr);
            });
        }
    }
});

module.exports = ShellExec;
