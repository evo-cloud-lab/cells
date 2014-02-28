var Class = require('js-class');

var Qemu = Class({

});


module.exports = function (data, node, info, callback) {
    callback(null, new Qemu(data, node));
};
