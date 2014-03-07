/** @fileoverview
 * Node is the facet of an isolated environment
 * inside which an operating system is running.
 * The inner isolated environment can be supported by
 * a certain containment implementation, like LXC,
 * KVM etc.
 *
 * A node is always associated with a state:
 * {
 *      name: string [mandatory] - current state of interior
 *      info: object [optional] - must be present when in 'fault' state
 * }
 *      The value of 'name' should be one of
 *          'offline'   The node is not loaded
 *          'loading'   The node is being loaded
 *          'unloading' The node is being unloaded
 *          'stopped'   The interior is ready, but not started
 *          'starting'  The interior has been requested to start, and is in progress
 *          'running'   The interior is started, and is running
 *          'stopping'  The interior has been requested to stop, and is in progress
 *
 * Driver Abstraction
 *
 * A driver registered here is a factory function which accepts parameters:
 *      id        Id of the node
 *      params    Parameters for creating the driver, opaque to upper-level components
 *      monitor   The monitoring function to receive all events
 *      logger    The logging facilitate
 *
 * The 'monitor' can be used to report status or errors, it is defined as
 *      function monitor(event, object);
 *      'event' is defined as:
 *          'state': driver state name, should be one of 'offline', 'stopped', 'running'
 *          'status': status update, object is driver specific or TO BE DEFINED
 *          'error': error happens, object is an Error instance
 *
 * An driver instance must providing the following methods:
 *
 * load: function (opts); [Optional]
 *      Request to load the driver.
 *      This method can only be used when 'state.name' is 'offline'.
 *
 * unload: function (opts); [Optional]
 *      Request to unload (offline) the driver.
 *      This method can only be used when 'state.name' is 'stopped'
 *      If not implemented, the container automatically goes to 'offline' state.
 *
 * start: function (opts);
 *      Request to start the driver.
 *      This method can only be used when 'state.name' is 'stopped'.
 *
 * stop: function (opts);
 *      Request to stop the driver.
 *      This method can only be used when 'state.name' is one of:
 *          'starting', 'running', 'stopping'.
 *
 *      'opts' can contain following properties:
 *          force: boolean  When true, kill the driver immediately.
 *
 * status: function (opts); [Optional]
 *      Request detailed status from the driver asynchronously.
 *      The reported status object should be passed through 'monitorFn' and
 *      schema is driver specific or TO BE DEFINED.
 */

var Class    = require('js-class'),
    flow     = require('js-flow'),
    path     = require('path'),
    _        = require('underscore'),
    mkdir    = require('mkdirp'),
    elements = require('evo-elements'),
    Config = elements.Config,
    Logger = elements.Logger,
    States = elements.States,
    Errors = elements.Errors,

    ManagementObject = require('./ManagementObject');

var STABLE_STATES = ['offline', 'stopped', 'running'];

function transitRule(action, intermediateState, targetState) {
    return function (expected, current, done) {
        var validStates = [targetState, intermediateState, current];
        this.current = intermediateState;
        var fn = this.node._interior[action];
        if (typeof(fn) == 'function') {
            fn.call(this.node._interior, {}, function (err) {
                this.current = err ? current : targetState;
                done(err, validStates);
            }.bind(this));
        } else {
            this.current = targetState;
            done(null, validStates);
        }
    };
}

var TransitRules = Class(States, {
    constructor: function (node, initialState) {
        States.prototype.constructor.call(this, initialState);
        this.node = node;
    },

    'offline:stopped': transitRule('load', 'loading', 'stopped'),
    'offline:running': transitRule('load', 'loading', 'stopped'),
    'stopped:offline': transitRule('unload', 'unloading', 'offline'),
    'stopped:running': transitRule('start', 'starting', 'running'),
    'running:stopped': transitRule('stop', 'stopping', 'stopped'),
    'running:offline': transitRule('stop', 'stopping', 'stopped')
});

var Node = Class(ManagementObject, {
    constructor: function (cluster, networks, id, props, options) {
        ManagementObject.prototype.constructor.call(this, 'node', id, props, options);

        this._cluster  = cluster;
        this._networks = networks;
        this._workdir  = path.join(cluster.workdir, 'c-' + id);

        (this._transits = new TransitRules(this, 'offline'))
            .on('done', this._stateReady.bind(this))
            .on('state', this._stateTransit.bind(this))
            .on('error', this._transitionError.bind(this));
    },

    get cluster () {
        return this._cluster;
    },

    get workdir () {
        return this._workdir;
    },

    get image () {
        return this._image;
    },

    network: function (id) {
        var found;
        this._networks.some(function (network) {
            if (network.id == id) {
                found = network;
                return true;
            }
            return false;
        });
        return found;
    },

    setup: function (callback) {
        flow.steps()
            .next(function (next) {
                mkdir(this.workdir, next);
            })
            .next(function (next) {
                this.context.loadImage(this.properties.image, function (err, image) {
                    !err && image && (this._image = image);
                    next(err);
                }.bind(this));
            })
            .next(function (next) {
                var interiorName = this.properties.interior || (this._image.manifest.node && this._image.manifest.node.interior);
                this.connectPlugin(
                    'cells:node.interior',
                    interiorName,
                    {
                        required: true,
                        extra: _.extend({
                                    monitor: this._monitorEvent.bind(this)
                                }, this._image.manifest.node || {})
                    },
                    function (err, interior) {
                        !err && (this._interior = interior);
                        next(err);
                    }.bind(this)
                );
            })
            .with(this)
            .run(callback);
    },

    dump: function () {
        return {
            image: this._image.id,
            name: this.name,
            state: {
                current: this.state,
                expected: this.expectedState,
            },
            status: this.recentStatus,
            interior: typeof(this._interior.dump) == 'function' ? this._interior.dump() : undefined,
            workdir: this.workdir
        };
    },

    update: function (props, callback) {
        if (!props) {
            callback(Errors.badParam('properties'));
        } else if (props.state == null) {
            callback(Errors.noAttr('state'));
        } else if (STABLE_STATES.indexOf(props.state) < 0) {
            callback(Errors.badAttr('state', props.state));
        } else {
            this.setState(props.state);
            callback();
        }
    },

    /** @field
     * @description Current state
     */
    get state () {
        return this._transits.current;
    },

    /** @field
     * @description expected State
     */
    get expectedState () {
        return this._transits.expectation;
    },

    /** @field
     * @description Recent status
     */
    get recentStatus() {
        return this._status;
    },

    /** @function
     * @description Set expected state
     */
    setState: function (expectedState) {
        if (STABLE_STATES.indexOf(expectedState) < 0) {
            throw new Error('Invalid Argument: ' + expectedState);
        }
        if (this._destructing) {
            return false;
        }
        return this._transits.setExpectation(expectedState);
    },

    /** @function
     * @description Request status query
     */
    status: function () {
        var fn = this._interior.status;
        typeof(fn) == 'function' && fn.call(this._interior);
        return this;
    },

    destruct: function (callback) {
        this._destructing = true;
        if (this._transits.setExpectation('offline')) {
            this._transits.once('done', function () {
                this._transits.removeAllListeners();
                callback();
            }.bind(this));
            this._transits.once('error', function (err) { callback(err); });
        } else {
            callback();
        }
    },

    // Internals

    _monitorEvent: function (event, data) {
        this.logger.verbose('MONITOR %s: %j', event, data);
        switch (event) {
            case 'error':
                this.logger.logError(data, {
                    message: 'Interior error: ' + data.message
                });
                break;
            case 'state':
                if (typeof(data) == 'string' && STABLE_STATES.indexOf(data) >= 0) {
                    this._transits.current = data;
                }
                break;
            case 'status':
                this._status = data;
                this.emit('status', data, this);
                break;
        }
    },

    _transitionError: function (err) {
        if (err.code == 'BADSTATE') {
            this.logger.error('Transition state inconsistent: exp=%s cur=%s valid=%j', err.expected, err.state, err.accepts);
        } else {
            this.logger.logError(err, {
                message: 'Transition error: ' + err.message
            });
        }
    },

    _stateTransit: function (curr, prev) {
        this.logger.debug('TRANSIT %s -> %s', prev, curr);
        this.emit('state', curr, prev, this);
    },

    _stateReady: function (state) {
        this.logger.verbose('READY %s', state);
        this.emit('ready', state, this);
    }
}, {
    implements: [process.EventEmitter],
});

module.exports = {
    exports: 'CRUD',

    refs: ['cluster', 'network'],

    create: function (id, props, refObjs, options, callback) {
        var node = new Node(refObjs.cluster[0], refObjs.network, id, props, options);
        node.setup(function (err) {
            callback(err, node);
        });
    }
};
