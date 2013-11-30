/**
 * Event bus wrapper for jsftp
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */

var vertx = require('vertx');
var container = require('vertx/container');
var Ftp = require('./jsftp');

var DatatypeConverter = Packages.javax.xml.bind.DatatypeConverter;

var ftpClModConfig;     // FTP client configuration (server, authentication)
                        // on module level
var sessions = {};      // "Hash" object with active FTP sessions
var nextSessionId = 1;  // Counter for the next FTP session id
var noOfSessions = 0;   // Number of active FTP sessions

// List of compound or "non-raw" FTP commands
var nonRawCommands = ['connect', 'disconnect', 'ls', 'list', 'get',
                      'put', 'rename', 'keepAlive'];

//If we have an address, connect to the event bus and expose the API
if (!container.config.address) {
    throw new Error('Must specify an event bus address when used as a ' + 
    'Vert.x module');
    container.exit();
} else {

    //===========================
    // Save module configuration
    //===========================
    ftpClModConfig = {
            host: 'localhost'
    };
    if (container.config.host) ftpClModConfig.host = container.config.host;
    if (container.config.port) ftpClModConfig.port = container.config.port;
    if (container.config.user) ftpClModConfig.user = container.config.user;
    if (container.config.pass) ftpClModConfig.pass = container.config.pass;

    //======================
    // Event Bus Connection
    //======================
    vertx.eventBus.registerHandler(container.config.address,
            function (ftpCmdJSON, replier) {
        var ftpCmd;             // Parsed send message data
        var ftpClient;          // FTP client
        var svrRespTimerId;     // Timer for server response
        var ftpClientConfig;    // Client configuration (server, authentication)
        
        // Initialize client configuration for the current command
        ftpClientConfig = ftpClModConfig;

        try {
            ftpCmd = JSON.parse(ftpCmdJSON);
            // "ftpCmd" is an object with the following properties:
            // "cmd": ftp command; either a ftp client command like ls or get
            //        or a raw command like pwd
            // "args": [array of strings] arguments for the command; for "put"
            //         from buffer, the buffer content is kept as a base64
            //         encoded string in an array with a single entry
            // "sessionId": Id for the ftp session keeping the TCP connection;
            //              if empty, a "one-shot" command will be issued
            // "timeout": Max time in ms for the server to respond
            //
            // The "raw" flag will be added depending on the given command:
            // "raw": boolean indicating wether to interpret "cmd" as a client
            //        command or a raw command
        } catch (parseErr) {
            replier(JSON.stringify({
                errorMsg: 'JSON parse error: ' + parseErr.toString()
            }));
            return;
        }
            
        // Make sure a command is specified
        if (typeof ftpCmd.cmd !== 'string' || ftpCmd.cmd.length === 0) {
            replier(JSON.stringify({
                errorMsg: 'No command specified.'
            }));
            return;
        }

        // Make sure, "args" is an array if given
        if (ftpCmd.args && !Array.isArray(ftpCmd.args)) {
            replier(JSON.stringify({
                errorMsg: 'Arguments not specified as an array.'
            }));
            return;            
        }
        
        // Disallow "auth" and "quit" commands; "connect" and "disconnect"
        // have to be used instead
        if (ftpCmd.cmd === 'auth' || ftpCmd.cmd === 'quit') {
            replier(JSON.stringify({
                errorMsg: 'Invalid command: ' + ftpCmd.cmd
            }));
            return;                    
        }
        
        if (ftpCmd.sessionId) {
            // Check if the session id is valid
            ftpClient = sessions[ftpCmd.sessionId];
            if (!ftpClient) {
                replier(JSON.stringify({
                    errorMsg: 'Invalid session id: ' + ftpCmd.sessionId
                }));
                return;
            }
            if (ftpCmd.cmd === 'connect') {
                replier(JSON.stringify({
                    errorMsg: '"connect" not allowed for existing ' +
                    'ftp session'
                }));
                return;                    
            }
            if (ftpCmd.cmd === 'disconnect') {
                // Remove the ftpClient from the sessions list
                delete sessions[ftpCmd.sessionId];
                noOfSessions--;
            }
        } else {
            // No session id => Create a new ftp client
            
            // "connect" is not mapped to any ftp client command
            if (ftpCmd.cmd === 'connect') {
                // Ensure max no of sessions is not exceeded
                if (container.config.maxSessions &&
                        noOfSessions >= container.config.maxSessions) {
                    replier(JSON.stringify({
                        errorMsg: 'Maximum number of sessions reached'
                    }));
                    return;
                }
                // Check if connection configuration is given as an
                // argument to the "connect" command.
                // args[0] has to be an object with the following
                // properties: host, port, user, pass
                if (ftpCmd.args && ftpCmd.args[0]) {
                    ftpClientConfig = ftpCmd.args[0];
                }
            }
            ftpClient = new Ftp(ftpClientConfig);
            if (ftpCmd.cmd === 'connect') {
                // From here on an ftpClient with a "_sessionId" property
                // signals that a "one-shot" command will be executed
                ftpClient._sessionId = nextSessionId++;
                sessions[ftpClient._sessionId] = ftpClient;
                noOfSessions++;
            }
            
            if (ftpCmd.cmd === 'disconnect') {
                replier(JSON.stringify({
                    errorMsg: '"disconnect" not allowed without ' +
                    'ftp session'
                }));
                return;                    
            }

            ftpClient.on('socketError', function (errorData) {
                if (this._sessionId) {
                    delete sessions[this._sessionId];
                    noOfSessions--;
                }
                this.destroy();
                replier(JSON.stringify({
                    errorMsg: errorData.toString()
                }));
                return;
            });

            // Publish debugging messages if enabled 
            if (container.config.debug && container.config.debugAddress) {
                ftpClient.on('cmdSend', function (cmdStr) {
                    vertx.eventBus.publish(container.config.debugAddress,
                            '[' + (this._sessionId || '-') +
                            ', ' + noOfSessions +
                            '] CLIENT: ' + cmdStr);
                });
                ftpClient.on('data', function (svrRes) {
                    vertx.eventBus.publish(container.config.debugAddress,
                            '[' + (this._sessionId || '-') +
                            ', ' + noOfSessions +
                            '] SERVER: ' + svrRes);
                });
            }
        }
                
        // Switch from
        //     * "connect" to the concrete ftp client "auth" command
        //     * "disconnect" to the concrete raw "quit" command
        // and map to raw and non-raw jsftp commands
        if (ftpCmd.cmd === 'connect') {
            ftpCmd.cmd = 'auth';
            ftpCmd.raw = false;
            ftpCmd.args = [];
            ftpCmd.args.push(ftpClientConfig.user || null);
            ftpCmd.args.push(ftpClientConfig.pass || null);
        } else if (ftpCmd.cmd === 'disconnect') {
            ftpCmd.cmd = 'quit';
            ftpCmd.raw = true;
            ftpCmd.args = [];
        } else if (nonRawCommands.indexOf(ftpCmd.cmd) > -1) {
            ftpCmd.raw = false;
        } else {
            ftpCmd.raw = true;
        }
        
        if (ftpCmd.raw) {
            // Normalize and check for known raw command
            ftpCmd.cmd = ftpCmd.cmd.trim().toLowerCase();
            if (typeof ftpClient.raw[ftpCmd.cmd] !== 'function') {
                if (!ftpClient._sessionId) {
                    // No session id => This is a "one-shot" command
                    ftpClient.destroy();
                }
                replier(JSON.stringify({
                    errorMsg: 'Unknown raw command.'
                }));
                return;                    
            }                     
        } else {
            // Check if non-raw command exists
            if (typeof ftpClient[ftpCmd.cmd] !== 'function') {
                if (!ftpClient._sessionId) {
                    // No session id => This is a "one-shot" command
                    ftpClient.destroy();
                }
                replier(JSON.stringify({
                    errorMsg: 'Unknown ftp client command: ' +
                        ftpCmd.cmd
                }));
                return;
            }

            // Special handling for "keepAlive" command
            if (ftpCmd.cmd === 'keepAlive') {
                if (ftpClient._sessionId) {
                    // "keepAlive" is a command without callback
                    ftpClient.keepAlive();
                    replier(JSON.stringify({
                        code: 299,
                        text: 'Keep alive set'
                    }));
                    return;
                } else {
                    // "keepAlive" not allowed as one-shot command
                    ftpClient.destroy();
                    replier(JSON.stringify({
                        errorMsg: 'Invalid "one-shot" command: ' +
                            ftpCmd.cmd
                    }));
                    return;
                }
            }
        }
                                        
        // Prepare the arguments array
        ftpCmd.args = ftpCmd.args || [];
        
        // Modify the arguments array for "put" in case the file
        // contents is given as a Base64 encoded string
        if (!ftpCmd.raw && ftpCmd.cmd === 'put' &&
                Array.isArray(ftpCmd.args[0])) {
            // First argument for the "put" is an array
            // => interpret the first element as a BASE 64 encoded
            // string
            ftpCmd.args[0] = new vertx.Buffer(
                DatatypeConverter.parseBase64Binary(ftpCmd.args[0]));
        }
        
        // Attach a callback function to the arguments arrays
        
        if (!ftpCmd.raw && ftpCmd.cmd === 'get' &&
                ftpCmd.args.length === 1) {
            // Special handling for the case when a file should be
            // retrieved into a "buffer" ("get" command with a
            // single argument)
            ftpCmd.args.push(function (err, socket) {
                var buffer = new vertx.Buffer();
                
                if (svrRespTimerId) {
                    vertx.cancelTimer(svrRespTimerId);
                    svrRespTimerId = undefined;
                }

                if (!err) {
                    socket.dataHandler(function(buf) {
                        buffer.appendBuffer(buf);
                    });
                    socket.exceptionHandler(function (error) {
                        replier(JSON.stringify({
                            errorMsg: error.toString()
                        }));
                        if (!ftpClient._sessionId) {
                            ftpClient.destroy();
                        }
                    });
                    
                    // Success case: Reply with a Base64 encoded buffer
                    socket.endHandler(function() {
                        replier(JSON.stringify({
                            code: 299,
                            text: 'Retrieved file successfully',
                            data: DatatypeConverter.
                                printBase64Binary(buffer.getBytes())
                        }));

                        socket.close();
                        if (!ftpClient._sessionId) {
                            // In case of a one-shot command: Send "quit"
                            // and close the connection
                            ftpClient.raw.quit();
                            ftpClient.destroy();
                        }
                    });
                    socket.resume();
                } else {
                    // "get" returned with an error
                    replier(JSON.stringify({
                        errorMsg: err.toString()
                    }));
                    if (!ftpClient._sessionId) {
                        // In case of a one-shot command: Send "quit"
                        // and close the connection
                        ftpClient.raw.quit();
                        ftpClient.destroy();
                    }
                }
            });
        } else if (ftpCmd.cmd !== 'quit') {
            // Handle all other cmd cases, except for "quit"
            // (raw and not-raw commands)
            ftpCmd.args.push(function (err, res) {
                if (svrRespTimerId) {
                    vertx.cancelTimer(svrRespTimerId);
                    svrRespTimerId = undefined;
                }
                
                if (!err) {
                    // Add the sessionId to the reply in case of the
                    // "auth" command
                    if (ftpCmd.cmd === 'auth' && ftpClient._sessionId) {
                        res.sessionId = ftpClient._sessionId;
                    }
                    // Be prepared for "res" being undefined, e.g.
                    // for the "get" command
                    replier(JSON.stringify(res || {
                        code: 299,
                        text: 'Command successfully executed'
                    }));
                } else {
                    // Clean up if "auth" not successfull
                    if (ftpCmd.cmd === 'auth' && ftpClient._sessionId) {
                        delete sessions[ftpClient._sessionId];
                        noOfSessions--;
                        ftpClient.destroy();
                    }
                    replier(JSON.stringify({
                        errorMsg: err.toString()
                    }));
                }
                if (!ftpClient._sessionId) {
                    // In case of a one-shot command: Send "quit"
                    // and close the connection
                    ftpClient.raw.quit();
                    ftpClient.destroy();
                }
            });
        }

        if (ftpCmd.cmd !== 'quit' && typeof ftpCmd.timeout === 'number') {
            svrRespTimerId = vertx.setTimer(ftpCmd.timeout, function () {
                if (!ftpClient._sessionId) {
                    ftpClient.destroy();
                }
                replier(JSON.stringify({
                    errorMsg: 'Timeout: Server took longer than '+
                        ftpCmd.timeout + ' ms to respond.'
                }));                    
            });
        }
        
        // Call the ftp client method via "apply"
        if (ftpCmd.raw) {
            if (ftpCmd.cmd === 'quit') {
                // Don't wait for a server reply on "quit"
                ftpClient.raw.quit();
                ftpClient.destroy();
                replier(JSON.stringify({
                    code: 299,
                    text: 'Sent "quit" to the server'
                }));
            } else {
                ftpClient.raw[ftpCmd.cmd].apply(ftpClient, ftpCmd.args);
            }
        } else {
            ftpClient[ftpCmd.cmd].apply(ftpClient, ftpCmd.args);
        }
    });
}
