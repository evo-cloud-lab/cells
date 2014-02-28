/** @fileoverview
 * This containment implementation uses external program
 * to manage containers.
 * There two ways for this implementation to interact with
 * the external program:
 *    - simple
 *        the configuration specifies 4 command lines for
 *        invoking external program:
 *            - start container
 *            - stop container
 *            - query container state
 *            - query status
 *
 *    - contract
 *        only one external program is provided as the
 *        controller of the container and is always running
 *        when loaded. this implementation class uses specially
 *        designed protocol to talk to the program via stdin/stdout
 */

var Class = require('js-class'),
    flow  = require('js-flow'),
    _     = require('underscore'),
    exec  = require('child_process').exec,
    spawn = require('child_process').spawn;

var InteriorBase = Class({
    constructor: function (node, data) {
        this._node = node;
        this._conf = data.params;
        this._logger  = data.logger;
        this._monitor = data.params.monitor;
    },

    get node () {
        return this._node;
    },

    get id () {
        return this.node.id;
    },

    get conf () {
        return this._conf;
    },

    get execOpts () {
        var opts = {
            env: _.extend(_.clone(process.env), { NODE_ID: this.id }),
            cwd: this.node.workdir
        };
        this._conf.uid && (opts.uid = this._conf.uid);
        this._conf.gid && (opts.gid = this._conf.gid);
        typeof(this._conf.env) == 'object' && _.extend(opts.env, this._conf.env);
        return opts;
    },

    report: function (event, info) {
        this._monitor(event, info);
    },

    logOutput: function (data, prefix) {
        this._logger.verbose(prefix + data.toString())
    },

    logStdout: function (data) {
        this.logOutput(data, '[STDOUT] ');
    },

    logStderr: function (data) {
        this.logOutput(data, '[STDERR] ');
    },

    parseStatus: function (text) {
        var result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            this._logger.error('Status parse error: %s', e.message);
        }
        return result;
    }
});

var SimpleInterior = Class(InteriorBase, {
    constructor: function () {
        InteriorBase.prototype.constructor.apply(this, arguments);
        this._progs = _.pick(this.conf, 'load', 'pre-start', 'start', 'post-start', 'pre-stop', 'stop', 'post-stop', 'unload', 'state', 'status');
        if (!this._progs.start) {
            throw new Error('Invalid Configuration: no start command');
        }
        this._inproc = this.conf.inproc || !this._progs.stop;
    },

    load: function (opts) {
        this._invokeOptional('load', 'stopped');
    },

    unload: function (opts) {
        this._invokeOptional('unload', 'offline');
    },

    start: function (opts) {
        var reportStop = true;
        this._invokeHooked('start', function (done) {
            reportStop = false;
            if (this._inproc) {
                (this._proc = spawn(process.env.SHELL || '/bin/sh', ['-c', 'exec ' + this._progs.start], this.execOpts))
                    .on('error', this._procError.bind(this))
                    .on('exit', this._procExit.bind(this));
                this._proc.stdout.on('data', function (data) {
                    this.logStdout(data);
                }.bind(this));
                this._proc.stderr.on('data', function (data) {
                    this.logStderr(data, true);
                }.bind(this));
                this.report('state', 'running');
                done();
            } else {
                this._invokeOptional('start', function (err) {
                    err || this.report('state', 'running');
                    done(err);
                }.bind(this));
            }
        }, function (err) {
            err && this.report('error', err);
            this._inproc || this._startStateMonitor();
            err && reportStop && this.report('state', 'stopped');
        }.bind(this));
    },

    stop: function (opts) {
        this._invokeHooked('stop', function (done) {
            if (this._progs.stop) {
                this._invokeOptional('stop', function (err) {
                    if (!err) {
                        this._stopStateMonitor();
                        delete this._proc;
                        this.report('state', 'stopped');
                    }
                    done(err);
                }.bind(this));
            } else if (this._proc) {
                this._proc.kill(opts.force ? 'SIGKILL' : 'SIGTERM');
                done();
            } else {
                this.report('state', 'stopped');
                done();
            }
        }, function (err) {
            err && this.report('error', err);
        }.bind(this), true);
    },

    status: function (opts) {
        if (this._progs.status) {
            exec(this._progs[name], function (err, stdout, stderr) {
                this.logStdout(stdout);
                this.logStderr(stderr);
                if (!err) {
                    var status = this.parseStatus(stdout);
                    status && this.report('status', status);
                }
            }.bind(this));
        }
    },

    _invokeOptional: function (name, callback) {
        if (typeof(callback) == 'string') {
            var nextState = callback;
            callback = function (err) {
                err ? this.report('error', err) : this.report('state', nextState);
            }.bind(this);
        }
        this._logger.verbose('INVOKE ' + name);
        if (this._progs[name]) {
            exec(this._progs[name], this.execOpts, function (err, stdout, stderr) {
                this.logStdout(stdout);
                this.logStderr(stderr);
                callback(err);
            }.bind(this));
        } else {
            callback();
        }
    },

    _invokeHooked: function (name, action, done, ignorePreErr) {
        flow.steps()
            .next(function (next) {
                this._invokeOptionalCmds('PRE-' + name.toUpperCase(), this._progs['pre-' + name], function (err) { next(ignorePreErr ? null : err); });
            })
            .next(function (next) {
                action.call(this, next);
            })
            .next(function (next) {
                this._invokeOptionalCmds('POST-' + name.toUpperCase(), this._progs['post-' + name], function () { next(); });
            })
            .with(this)
            .run(done);
    },

    _invokeOptionalCmds: function (prefix, cmds, done) {
        typeof(cmds) == 'string' && (cmds = [cmds]);
        if (Array.isArray(cmds)) {
            flow.each(cmds)
                .series()
                .do(function (cmd, next) {
                    cmd = cmd.trim();
                    var ignoreErr;
                    if (cmd[0] == '-') {
                        ignoreErr = true;
                        cmd = cmd.substring(1);
                    }
                    this._logger.verbose(prefix + ' INVOKE ' + cmd);
                    exec(cmd, this.execOpts, function (err, stdout, stderr) {
                        this.logStdout(stdout);
                        this.logStderr(stderr);
                        err && !ignoreErr && this._logger.error('INVOKE ERR: %j %s', err, cmd);
                        next(ignoreErr ? null : err);
                    }.bind(this));
                })
                .with(this)
                .run(done);
        } else {
            done();
        }
    },

    _startStateMonitor: function () {
        var stateProg = this._progs.state;
        if (stateProg) {
            var delay = this.conf.monitorDelay || 1000;
            this._monitoring = true;
            var monitor = function () {
                delete this._monitorTimer;
                this._logger.debug('QUERY_STATE');
                exec(stateProg, this.execOpts, function (err) {
                    this._logger.debug('STATE %d', err ? 1 : 0);
                    if (this._monitoring) {
                        this.report('state', err ? 'stopped' : 'running');
                        this._monitorTimer = setTimeout(monitor, delay);
                    }
                }.bind(this));
            }.bind(this);
            monitor();
        }
    },

    _stopStateMonitor: function () {
        delete this._monitoring;
        if (this._monitorTimer) {
            clearTimeout(this._monitorTimer);
            delete this._monitorTimer;
        }
    },

    _procError: function (err) {
        delete this._proc;
        this.report('error', err);
    },

    _procExit: function () {
        delete this._proc;
        this.report('state', 'stopped');
    }
});

var ContractInterior = Class({
    constructor: function () {
        InteriorBase.prototype.apply(this, arguments);
        this._ctl = this.conf.ctl;
    },

    load: function (opts) {
        this._partialResp = '';
        delete this._unloading;
        (this._proc = spawn(process.env.SHELL || '/bin/sh', ['-c', 'exec ' + this._ctl], this.execOpts))
            .on('error', this._procError.bind(this))
            .on('exit', this._procExit.bind(this));
        this._proc.stdout.on('data', this._procResponse.bind(this));
        this._proc.stderr.on('data', this._procOutput.bind(this));
    },

    unload: function (opts) {
        if (this._proc) {
            this._unloading = true;
            this._proc.kill(opts.force ? 'SIGKILL' : 'SIGTERM');
        } else {
            this.report('state', 'offline');
        }
    },

    start: function (opts) {
        this._send('START');
    },

    stop: function (opts) {
        this._send(opts.force ? 'STOP-FORCE' : 'STOP');
    },

    status: function (opts) {
        this._send('STATUS');
    },

    _send: function (command) {
        if (this._proc) {
            this._proc.stdin.write(command + "\n");
        } else {
            throw new Error('Operation not supported when offline');
        }
    },

    _procError: function (err) {
        this.report('error', err);
        delete this._proc;
        delete this._unloading;
        this.report('state', 'offline');
    },

    _procExit: function () {
        delete this._proc;
        var unloading = this._unloading;
        delete this._unloading;
        if (unloading) {
            this.report('state', 'offline');
        }
    },

    _procResponse: function (data) {
        this._partialResp += data.toString();
        var resps = this._partialResp.split("\n");
        this._partialResp = resps.pop();
        for (var i in resps) {
            var line = resps[i].trim();
            var pos = line.indexOf(' ');
            var event = pos >= 0 ? line.substr(0, pos) : line;
            var rest = pos >= 0 ? line.substr(pos + 1).trim() : '';
            switch (event.toLowerCase()) {
                case 'state':
                    this.report('state', rest.toLowerCase());
                    break;
                case 'error':
                    this.report('error', new Error(rest));
                    break;
                case 'status':
                    var status = this.parseStatus(rest);
                    status && this.report('status', status);
                    break;
            }
        }
    },

    _procOutput: function (data) {
        this.logStderr(data);
    }
});

module.exports = function (data, node, info, callback) {
    var err, interior;
    try {
        interior = data.params.ctl ? new ContractInterior(node, data)
                                   : new SimpleInterior(node, data);
    } catch(e) {
        err = e;
    }
    callback(err, interior);
};
