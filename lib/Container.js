/** @fileoverview
 * Container is the facet of an isolated environment
 * inside which an operating system is running.
 * The inner isolated environment can be supported by
 * a certain containment implementation, like LXC,
 * KVM etc.
 *
 * A container is always associated with a state:
 * {
 *      name: string [mandatory] - current state of interior
 *      info: object [optional] - must be present when in 'fault' state
 * }
 *      The value of 'name' should be one of
 *          'offline'   The container is not loaded
 *          'loading'   The container is being loaded
 *          'unloading' The container is being unloaded
 *          'stopped'   The interior is ready, but not started
 *          'starting'  The interior has been requested to start, and is in progress
 *          'running'   The interior is started, and is running
 *          'stopping'  The interior has been requested to stop, and is in progress
 *
 * Driver Abstraction
 *
 * A driver registered here is a factory function which accepts parameters:
 *      id        Id of the container
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
    plugins  = require('js-plugins'),
    elements = require('evo-elements'),
    Config = elements.Config,
    Logger = elements.Logger,
    States = elements.States,
    Errors = elements.Errors,

    ManagementObject = require('./ManagementObject');

var STABLE_STATES = ['offline', 'stopped', 'running'];

var TransitRules = Class(States, {
    constructor: function (container, initialState) {
        States.prototype.constructor.call(this, initialState);
        this.container = container;
    },

    'offline:stopped': function () {
        this._invoke('loading', 'load', 'stopped');
        return ['loading', 'stopped'];
    },

    'offline:running': function () {
        this._invoke('loading', 'load', 'stopped');
        return ['loading', 'stopped'];
    },

    'loading:offline': function () {
        this._invoke('unloading', 'unload', 'offline');
        return ['unloading', 'stopped', 'offline'];
    },

    'loading:stopped': function () {
        return ['stopped'];
    },

    'loading:running': function () {
        return ['stopped'];
    },

    'stopped:offline': function () {
        this._invoke('unloading', 'unload', 'offline');
        return ['unloading', 'offline'];
    },

    'stopped:running': function () {
        this._invoke('starting', 'start');
        return ['starting', 'running'];
    },

    'starting:offline': function () {
        this._invoke('stopping', 'stop');
        return ['running', 'stopping', 'stopped'];
    },

    'starting:stopped': function () {
        this._invoke('stopping', 'stop');
        return ['running', 'stopping', 'stopped'];
    },

    'starting:running': function () {
        return ['running'];
    },

    'running:stopped': function () {
        this._invoke('stopping', 'stop');
        return ['stopping', 'stopped'];
    },

    'running:offline': function () {
        this._invoke('stopping', 'stop');
        return ['stopping', 'stopped'];
    },

    'stopping:offline': function () {
        return ['stopped'];
    },

    'stopping:stopped': function () {
        return ['stopped'];
    },

    'stopping:running': function () {
        return ['stopped'];
    },

    'unloading:offline': function () {
        return ['offline'];
    },

    'unloading:stopped': function () {
        return ['offline'];
    },

    'unloading:running': function () {
        return ['offline'];
    },

    _invoke: function (intermediateState, action, autoTransitState) {
        process.nextTick(function () {
            this.current = intermediateState;
            var fn = this.container._driver[action];
            if (typeof(fn) == 'function') {
                process.nextTick(function () { fn.call(this, {}); }.bind(this.container._driver));
            } else if (autoTransitState) {
                process.nextTick(function () { this.current = autoTransitState; }.bind(this));
            }
        }.bind(this));
    }
});

var Container = Class(ManagementObject, {
    constructor: function (networks, id, props, options) {
        ManagementObject.prototype.constructor.call(this, 'container', id, props, options);

        this._networks = networks;

        (this._transits = new TransitRules(this, 'offline'))
            .on('done', this._stateReady.bind(this))
            .on('state', this._stateTransit.bind(this))
            .on('error', this._transitionError.bind(this));
    },

    load: function (callback) {
        plugins.connect(this, 'cells:contaienr', {
            name: this.properties.driver,
            data: this.pluginData(this.properties, this.properties.driver, {
                        monitor: this._monitorEvent.bind(this)
                    }),
            required: true
        }, function (err, driver) {
            !err && (this._driver = driver);
            driver && (this._driverState = 'offline');
            callback(err);
        }.bind(this));
    },

    dump: function () {
        return {
            state: {
                current: this.state,
                expected: this.expectedState,
            },
            status: this.recentStatus,
            driver: {
                name:  this.properties.driver,
                state: this.driverState
            }
        };
    },

    update: function (props, callback) {
        var state = props.state;
        if (STABLE_STATES.indexOf(state) < 0) {
            callback(Errors.badAttr('state', state, { status: 400 }));
        } else {
            this.setState(state);
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
     * @description Driver state
     */
    get driverState () {
        return this._driverState;
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
        return this._transits.setExpectation(expectedState);
    },

    /** @function
     * @description Request status query
     */
    status: function () {
        var fn = this._driver.status;
        typeof(fn) == 'function' && fn.call(this._driver);
        return this;
    },

    // Internals

    _monitorEvent: function (event, data) {
        this.logger.verbose('MONITOR %s: %j', event, data);
        switch (event) {
            case 'error':
                this._driverError(data);
                break;
            case 'state':
                if (typeof(data) == 'string' && STABLE_STATES.indexOf(data) >= 0) {
                    this._driverState = data;
                    this._transits.current = data;
                }
                break;
            case 'status':
                this._status = data;
                this.emit('status', data, this);
                break;
        }
    },

    _driverError: function (err) {
        this.logger.error('DRIVER ERROR: %s', err.message);
        this.emit('error', err, this);
    },

    _transitionError: function (err) {
        this.logger.error('TRANSITION ERROR: %s !%s %j', err.expectation, err.actual, err.accepts);
        this.emit('error', err, this);
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
    export: true,

    refs: ['cluster', 'network'],

    create: function (id, props, refObjs, options, callback) {
        var container = new Container(refObjs.network, id, props, options);
        container.load(function (err) {
            callback(err, container);
        });
    },

    reload: function (data, callback) {
        callback(new Error('Not implemented'));
    }
};
