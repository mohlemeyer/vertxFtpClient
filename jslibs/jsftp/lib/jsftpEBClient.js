/**
 * JavaScript wrapper for the jsftp event bus wrapper
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */

var vertx = require('vertx');
var when = require('jslibs/jsftp/thirdPartyDeps/when/when');

// List of all supported FTP commands;
// these will be made available as methods of the FTP event bus client
var FTP_CLIENT_COMMANDS =
    [
     // Connection handling
     'connect', 'disconnect',

     // Compound commands
     'ls', 'list', 'get', 'put', 'rename', 'keepAlive',

     // Raw commands from jsftp (non-working commands commented out)
     /*'abor',*/ 'pwd', 'cdup', 'feat', 'noop', 'pasv', 'syst',
     'cwd', 'dele', 'mdtm', 'mkd', 'mode', /*'nlst',*/ /*'retr',*/ 'rmd',
     'rnfr', 'rnto', 'site', 'stat', /*'stor',*/ 'type', /*'xrmd',*/ 'opts',
     /*'chmod'*/, 'size'
     ];

/**
 * Constructor for FTP Event Bus Clients
 * 
 * @param {string} ebAddress Each client need a fixed event bus address of a
 * FTP client verticle
 * 
 * @constructor
 */
function FtpEbClient (ebAddress) {
    this.ebAddress = ebAddress;
} // END: FtpEbClient()

/**
 * Check if the client is currently connected.<br>
 * <br>
 * The client is considered to be connected if an FTP session is established.
 * 
 * @returns {boolean} true if an FTP session exists for the client
 */
FtpEbClient.prototype.isConnected = function () {
    return this._sessionId ? true : false;
}; // END: isConnected()

/**
 * Set the timeout for subsequent commands.<br>
 * <br>
 * The timeout will be set for number larger than zero. Passing in zero or
 * undefined will effectively delete the timeout.
 * 
 * @param {integer} maxTime Maximum command run time in ms
 */
FtpEbClient.prototype.setTimeout = function (maxTime) {
    this._timeout = maxTime;
}; // END: setTimeout()

// Attach all supported FTP commands to the client prototype 
FTP_CLIENT_COMMANDS.forEach(function (command) {
    FtpEbClient.prototype[command] = function () {
        var self = this;
        var deferred;
        var ebCmd;
        
        deferred = when.defer();
        
        // Basic "event bus command" (to be stringified) 
        ebCmd = {
                cmd: command,
                args: Array.slice(arguments)
        };

        // Add the session id to the command, if one exists
        if (self._sessionId) {
            if (command === 'connect') {
                return when.reject('Already connected');
            }
            ebCmd.sessionId = self._sessionId;
        }

        // Remove the session id on disconnect
        if (command === 'disconnect') {
            if (!self._sessionId) {
                return when.reject('Not connected');
            }
            self._sessionId = undefined;
        }

        // Add the timeout to the command, if one is set
        if (typeof self._timeout === 'number' && self._timeout > 0) {
            ebCmd.timeout = self._timeout;
        }
        
        // Send the command on the event bus
        vertx.eventBus.send(self.ebAddress, JSON.stringify(ebCmd),
                function (replyJSON) {
            var reply = JSON.parse(replyJSON);
            if (reply.errorMsg) {
                deferred.reject(reply.errorMsg);
            } else {
                if (command === 'connect') {
                    self._sessionId = reply.sessionId;
                }
                deferred.resolve(reply);
            }
        });

        return deferred.promise;
    };
});

// Export the constructor
module.exports = FtpEbClient;
