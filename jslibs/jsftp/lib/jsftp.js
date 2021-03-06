/* vim:set ts=2 sw=2 sts=2 expandtab */
/*global require: true module: true */
/*
 * @package jsftp
 * @copyright Copyright(c) 2012 Ajax.org B.V. <info@c9.io>
 * @author Sergi Mansilla <sergi.mansilla@gmail.com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */

var vertx = require('vertx');
var EventEmitter = require("jslibs/jsftp/thirdPartyDeps/eventemitter2/eventemitter2").EventEmitter2;
var responseHandler = require("./response");
var ListingParser = require("jslibs/jsftp/thirdPartyDeps/parseListing/parser");
var util = require("jslibs/jsftp/thirdPartyDeps/nodejs/util/util");
var once = require("jslibs/jsftp/thirdPartyDeps/once/once");

var FTP_PORT = 21;
var DEBUG_MODE = false;
var TIMEOUT = 10 * 60 * 1000;
var IDLE_TIME = 30000;
var NOOP = function() {};
var COMMANDS = [
  // Commands without parameters
  "abor", "pwd", "cdup", "feat", "noop", "quit", "pasv", "syst",
  // Commands with one or more parameters
  "cwd", "dele", "list", "mdtm", "mkd", "mode", "nlst", "retr", "rmd",
  "rnfr", "rnto", "site", "stat", "stor", "type", "user", "pass", "xrmd", "opts",
  // Extended features
  "chmod", "size"
];

function getPasvPort(text) {
    var RE_PASV = /([-\d]+,[-\d]+,[-\d]+,[-\d]+),([-\d]+),([-\d]+)/;
    var match = RE_PASV.exec(text);
    if (!match) return false;

    // Array containing the passive host and the port number
    return [match[1].replace(/,/g, "."),
      (parseInt(match[2], 10) & 255) * 256 + (parseInt(match[3], 10) & 255)];
}

function runCmd(cmd) {
    var callback = NOOP;
    var args = [].slice.call(arguments);
    var completeCmd = args.shift();
    if (args.length) {
      if (typeof args[args.length - 1] === "function")
        callback = args.pop();

      completeCmd += " " + args.join(" ");
    }
    this.execute(completeCmd.trim(), callback);
}

//Codes from 100 to 200 are FTP marks
function isMark(code) {
    code = parseInt(code, 10);
    return code > 100 && code < 200;
}

var Ftp = module.exports = function(cfg) {
  "use strict";

  Object.keys(cfg).forEach(function(opt) {
    if (!this[opt]) this[opt] = cfg[opt];
  }, this);

  EventEmitter.call(this);

  // True if the server doesn't support the `stat` command. Since listing a
  // directory or retrieving file properties is quite a common operation, it is
  // more efficient to avoid the round-trip to the server.
  this.useList = false;
  this.port = this.port || FTP_PORT;
  this.pending = []; // Pending requests
  this.cmdBuffer_ = [];
  this.responseHandler = responseHandler();

  // Generate generic methods from parameter names. they can easily be
  // overriden if we need special behavior. they accept any parameters given,
  // it is the responsability of the user to validate the parameters.
  this.raw = {};
  COMMANDS.forEach(function(cmd) {
    this.raw[cmd] = runCmd.bind(this, cmd);
  }, this);

  // this.socket = this._createSocket(this.port, this.host);
};

util.inherits(Ftp, EventEmitter);

Ftp.prototype.reemit = function(event) {
  var self = this;
  return function(data) { self.emit(event, data); };
};

Ftp.prototype._createSocket = function(port, host, firstAction) {
    if (this.socket) {
        try {
            this.socket.close();
            this.socket = undefined;
        } catch (discardErr) {}
    }

    this.authenticated = false;
    var self = this;
    
    if (!this.vertxNetClient) {
        this.vertxNetClient = vertx.createNetClient();
    }
    if (!firstAction) {
        firstAction = NOOP;
    }
    this.vertxNetClient.connect(port, host, function(err, sock) {
        if (!err) {
            self.socket = sock;
            self._createStreams(self.socket);
            firstAction();
        } else {
            firstAction(err);
        }
    });
};

Ftp.prototype._createStreams = function(socket) {
    var self = this;
    
    this.pipeline = socket;
    this.pipeline.dataHandler(function(buffer) {
        var bufferStr = buffer.toString();
        var bufferSplitted = bufferStr.split('\n');
        var dataChunk;
        
        for (var i = 0; i < bufferSplitted.length; i++) {
            if (bufferSplitted[i].length > 0) {
                dataChunk = self.responseHandler(bufferSplitted[i]);
                if (dataChunk) {
                    self.emit('data', bufferSplitted[i]);
                    self.parseResponse.call(self, dataChunk);
                }
            }
        }
      }
    );
    this.pipeline.exceptionHandler(this.reemit("socketError"));
};

Ftp.prototype.parseResponse = function(data) {
  if (!this.cmdBuffer_.length)
    return;

  if ([220].indexOf(data.code) > -1)
    return;

  var next = this.cmdBuffer_[0][1];
  if (isMark(data.code) || data.code === 226) {
    // If we receive a Mark and it is not expected, we ignore
    // that command
    if (!next.expectsMark || next.expectsMark.marks.indexOf(data.code) === -1)
      return;
    // We might have to ignore the command that comes after the
    // mark.
    if (next.expectsMark.ignore)
      this.ignoreCmdCode = next.expectsMark.ignore;
  }

  if (this.ignoreCmdCode && this.ignoreCmdCode === data.code) {
    this.ignoreCmdCode = null;
    return;
  }

  this.ignoreCmdCode = null;
  this.parse(data, this.cmdBuffer_.shift());
};

/**
 * Sends a new command to the server.
 *
 * @param {String} command Command to write in the FTP socket
 * @return void
 */
Ftp.prototype.send = function(command) {
  if (!command || typeof command !== "string")
    return;

  this.emit("cmdSend", command);
  this.pipeline.write(command + "\r\n");
};

Ftp.prototype.nextCmd = function() {
  if (!this.inProgress && this.cmdBuffer_[0]) {
    this.send(this.cmdBuffer_[0][0]);
    this.inProgress = true; 
  }
};

/**
 * Check whether the ftp user is authenticated at the moment of the
 * enqueing. ideally this should happen in the `push` method, just
 * before writing to the socket, but that would be complicated,
 * since we would have to 'unshift' the auth chain into the queue
 * or play the raw auth commands (that is, without enqueuing in
 * order to not mess up the queue order. ideally, that would be
 * built into the queue object. all this explanation to justify a
 * slight sloppiness in the code flow.
 *
 * @param {string} action
 * @param {function} callback
 * @return void
 */
Ftp.prototype.execute = function(action, callback) {
  if (!callback) callback = NOOP;

  if (this.socket) {
    return this.runCommand(action, callback);
  }
  
  var self = this;
  this.authenticated = false;
  this._createSocket(this.port, this.host, function(err) {
      if (!err) {
          self.runCommand(action, callback);
      } else {
          callback(err);
      }
    }
  );
};

Ftp.prototype.runCommand = function(action, callback) {
  var self = this;

  function executeCmd() {
    self.cmdBuffer_.push([action, callback]);
    self.nextCmd();
  }

  if (self.authenticated || /feat|syst|user|pass/.test(action)) {
    return executeCmd();
  }
  
  this.getFeatures(function() {
    self.auth(self.user, self.pass, executeCmd);
  });
};

/**
 * Parse is called each time that a comand and a request are paired
 * together. That is, each time that there is a round trip of actions
 * between the client and the server.
 *
 * @param response {Object} Response from the server (contains text and code).
 * @param command {Array} Contains the command executed and a callback (if any).
 */
Ftp.prototype.parse = function(response, command) {
  // In FTP every response code above 399 means error in some way.
  // Since the RFC is not respected by many servers, we are going to
  // overgeneralize and consider every value above 399 as an error.
  var err = null;
  if (response.code > 399) {
    err = new Error(response.text || "Unknown FTP error.");
    err.code = response.code;
  }

  command[1](err, response);
  this.inProgress = false; 
  this.nextCmd(); 
};

/**
 * Returns true if the current server has the requested feature.
 *
 * @param {String} feature Feature to look for
 * @returns {Boolean} Whether the current server has the feature
 */
Ftp.prototype.hasFeat = function(feature) {
  if (feature)
    return this.features.indexOf(feature.toLowerCase()) > -1;
};

/**
 * Returns an array of features supported by the current FTP server
 *
 * @param {String} features Server response for the 'FEAT' command
 * @returns {String[]} Array of feature names
 */
Ftp.prototype._parseFeats = function(features) {
  // Ignore header and footer
  return features.split(/\r\n|\n/).slice(1, -1).map(function(feat) {
    return (/^\s*(\w*)\s*/).exec(feat)[1].trim().toLowerCase();
  });
};

// Below this point all the methods are action helpers for FTP that compose
// several actions in one command
Ftp.prototype.getFeatures = function(callback) {
  var self = this;
  if (!this.features)
    this.raw.feat(function(err, response) {
      self.features = err ? [] : self._parseFeats(response.text);
      self.raw.syst(function(err, res) {
        if (!err && res.code === 215)
          self.system = res.text.toLowerCase();

        callback(null, self.features);
      });
    });
  else
    callback(null, self.features);
};

/**
 * Authenticates the user.
 *
 * @param user {String} Username
 * @param pass {String} Password
 * @param callback {Function} Follow-up function.
 */
Ftp.prototype.auth = function(user, pass, callback) {
  this.pending.push(callback);

  var self = this;

  function notifyAll(err, res) {
    var cb;
    while (cb = self.pending.shift())
      cb(err, res);
  }

  if (this.authenticating) return;

  if (!user) user = "anonymous";
  if (!pass) pass = "@anonymous";

  this.authenticating = true;
  self.raw.user(user, function(err, res) {
    if (!err && [230, 331, 332].indexOf(res.code) > -1) {
      self.raw.pass(pass, function(err, res) {
        self.authenticating = false;

        if (err)
          notifyAll(new Error("Login not accepted"));

        if ([230, 202].indexOf(res.code) > -1) {
          self.authenticated = true;
          self.user = user;
          self.pass = pass;
          self.raw.type("I", function() {
            notifyAll(null, res);
          });
        } else if (res.code === 332) {
          self.raw.acct(""); // ACCT not really supported
        }
      });
    } else {
      self.authenticating = false;
      notifyAll(new Error("Login not accepted"));
    }
  });
};

Ftp.prototype.setType = function(type, callback) {
  if (this.type === type)
    callback(null);

  var self = this;
  this.raw.type(type, function(err, data) {
    if (!err) self.type = type;

    callback(err, data);
  });
};

/**
 * Lists a folder's contents using a passive connection.
 *
 * @param {String} [path] Remote path for the file/folder to retrieve
 * @param {Function} callback Function to call with errors or results
 */
Ftp.prototype.list = function(path, callback) {
  if (arguments.length === 1) {
    callback = arguments[0];
    path = "";
  }

  var self = this;
  var cb = function(err, listing) {
    self.setType("I", once(function() {
      callback(err, listing);
    }));
  };
  cb.expectsMark = {
    marks: [125, 150],
    ignore: 226
  };

  var listing = "";
  this.setType("A", function() {
    self.getPasvSocket(function(err, socket) {
        if (err) {
            callback(err);
            return;
        }
        socket.dataHandler(function(data) {
            listing += data;
        });
        socket.endHandler(function() {
            socket.close();
            cb(null, listing);
        });
        socket.exceptionHandler(function(ex) {
            socket.close();
            if (ex) {
                cb(ex);
            } else {
                cb(new Error('Exception on retrieving listing from path "' +
                        path + '"'));              
            }
        });
        
      self.send("list " + (path || ""));
    });
  });
};

Ftp.prototype.emitProgress = function(data) {
  this.emit('progress', {
    filename: data.filename,
    action: data.action,
    total: data.totalSize || 0,
    transferred: data.socket[
      data.action === 'get' ? 'bytesRead' : 'bytesWritten']
  });
};

/**
 * Depending on the number of parameters, returns the content of the specified
 * file or directly saves a file into the specified destination. In the latter
 * case, an optional callback can be provided, which will receive the error in
 * case the operation was not successful.
 *
 * @param {String} remotePath File to be retrieved from the FTP server
 * @param {String} localPath Local path where the new file will be created
 * @param {Function} [callback] Gets called on either success or failure
 */
Ftp.prototype.get = function(remotePath, localPath, callback) {
  var self = this;
  if (arguments.length === 2) {
    callback = once(localPath || NOOP);
    this.getGetSocket(remotePath, callback);
  } else {
    callback = once(callback || NOOP);
    this.getGetSocket(remotePath, function(err, socket) {
      if (err) {
        callback(err);
        return;
      }

      vertx.fileSystem.open(localPath, function(error, asyncFile) {
          if (error) {
              callback(error);
              return;
          }
          
          socket.endHandler(function () {
              asyncFile.flush(function (flushErr) {
                  socket.close();
                  if (flushErr) {
                      callback(flushErr);
                  } else {
                      asyncFile.close(function (closeErr) {
                          if (closeErr) {
                              callback(closeErr);
                          } else {
                              callback();
                          }
                      });
                  }
              });
          });

          socket.exceptionHandler(function(ex) {
              try {
                  asyncFile.close();
                  socket.close();
              } catch (closeErr) {}
              
              callback(ex);
          });
          
          asyncFile.exceptionHandler(function(ex) {
              try {
                  asyncFile.close();
                  socket.close();
              } catch (closeErr) {}
              
              callback(ex);
          });

          new vertx.Pump(socket, asyncFile).start();  
          socket.resume();
      });
    });
  }
};

/**
 * Returns a socket for a get (RETR) on a path. The socket is ready to be
 * streamed, but it is returned in a paused state. It is left to the user to
 * resume it.
 *
 * @param path {String} Path to the file to be retrieved
 * @param callback {Function} Function to call when finalized, with the socket as a parameter
 */
Ftp.prototype.getGetSocket = function(path, callback) {
  var self = this;
  callback = once(callback);
  this.getPasvSocket(function(err, socket) {
    if (err) return cmdCallback(err);

    socket.pause();

    function cmdCallback(err, res) {
      if (err) return callback(err);

      if (res.code === 125 || res.code === 150)
        callback(null, socket);
      else
        callback(new Error("Unexpected command " + res.text));
    }

    cmdCallback.expectsMark = {
      marks: [125, 150],
      ignore: 226
    };
    self.execute("retr " + path, cmdCallback);
  });
};

/**
 * Uploads contents on a FTP server. The `from` parameter can be a Buffer or the
 * path for a local file to be uploaded.
 *
 * @param {String|Buffer} from Contents to be uploaded.
 * @param {String} to path for the remote destination.
 * @param {Function} callback Function to execute on error or success.
 */
Ftp.prototype.put = function(from, to, callback) {
  var self = this;
  
  if (from instanceof vertx.Buffer) {
    this.getPutSocket(to, function(err, socket) {
      if (!err) {
          callback.expectsMark = { marks: [226] };
          self.cmdBuffer_.push([undefined, callback]);
          socket.write(from);
          socket.close(); // Closing only happens after all writes have been
                          // handled. Only closing the socket makes the server
                          // finally respond with "226 File receive OK.".
      }
    }, callback);
  } else if (typeof from === "string" || from instanceof String) {
    vertx.fileSystem.exists(from, function(exErr, exists) {
      if (exErr) {
          return callback(exErr);
      }
      if (!exists)
        return callback(new Error("Local file doesn't exist."));

      vertx.fileSystem.open(from, function(openErr, asyncFile) {
          if (openErr) {
              callback(openErr);
          } else {
              self.getPutSocket(to, function(sockErr, socket) {
                  if (sockErr) {
                      callback(sockErr);
                  } else {
                      asyncFile.endHandler(function() {
                          asyncFile.close();
                          socket.close();
                      });

                      callback.expectsMark = { marks: [226] };
                      self.cmdBuffer_.push([undefined, callback]);
                      new vertx.Pump(asyncFile, socket).start();
                  }
              }, callback);
          }
      });
    });
  } else {
      this.getPutSocket(to, function(err, socket) {
          if (!err) {
              callback.expectsMark = { marks: [226] };
              self.cmdBuffer_.push([undefined, callback]);
              from.endHandler(function () {
                  socket.close(); // Only closing the socket makes
                                  // the server finally respond with
                                  // "226 Filereceive OK.".                  
              });
              new vertx.Pump(from, socket).start();
          }
      }, callback);
  }
};

Ftp.prototype.getPutSocket = function(path, callback, doneCallback) {
  if (!callback) throw new Error("A callback argument is required.");

  doneCallback = once(doneCallback || NOOP);
  var _callback = once(function(err, _socket) {
    if (err) {
      callback(err);
      return doneCallback(err);
    }
    return callback(err, _socket);
  });

  var self = this;
  this.getPasvSocket(function(err, socket) {
    if (err) return _callback(err);

    var putCallback = once(function putCallback(err, res) {
      if (err) return _callback(err);

      // Mark 150 indicates that the 'STOR' socket is ready to receive data.
      // Anything else is not relevant.
      if (res.code === 125 || res.code === 150) {
        //socket.endHandler(doneCallback);
        socket.exceptionHandler(function (ex) {
            doneCallback(ex);
        });
        _callback(null, socket);
      } else {
        return _callback(new Error("Unexpected command " + res.text));
      }
    });
    putCallback.expectsMark = {
      marks: [125, 150]
    };
    self.execute("stor " + path, putCallback);
  });
};

Ftp.prototype.getPasvSocket = function(callback) {
  var self = this;
  var timeout = this.timeout;
  callback = once(callback || NOOP);
  this.execute("pasv", function(err, res) {
    if (err) return callback(err);

    var pasvRes = getPasvPort(res.text);
    if (pasvRes === false)
      return callback(new Error("PASV: Bad host/port combination"));

    var host = pasvRes[0];
    var port = pasvRes[1];
    
    if (!self.vertxNetClient) {
        self.vertxNetClient = vertx.createNetClient();
    }
    self.vertxNetClient.connect(port, host, function(err, sock) {
        if (!err) {
            callback(null, sock);
        } else {
            callback(err);
        }
    });
  });
};

/**
 * Provides information about files. It lists a directory contents or
 * a single file and yields an array of file objects. The file objects
 * contain several properties. The main difference between this method and
 * 'list' or 'stat' is that it returns objects with the file properties
 * already parsed.
 *
 * Example of file object:
 *
 *  {
 *      name: 'README.txt',
 *      type: 0,
 *      time: 996052680000,
 *      size: '2582',
 *      owner: 'sergi',
 *      group: 'staff',
 *      userPermissions: { read: true, write: true, exec: false },
 *      groupPermissions: { read: true, write: false, exec: false },
 *      otherPermissions: { read: true, write: false, exec: false }
 *  }
 *
 * The constants used in the object are defined in ftpParser.js
 *
 * @param filePath {String} Path to the file or directory to list
 * @param callback {Function} Function to call with the proper data when
 * the listing is finished.
 */
Ftp.prototype.ls = function(filePath, callback) {
  function entriesToList(err, entries) {
    if (err) {
      return callback(err);
    }    
    ListingParser.parseFtpEntries(entries.text || entries, callback);
  }

  if (this.useList) {
    this.list(filePath, entriesToList);
  } else {
    var self = this;
    this.raw.stat(filePath, function(err, data) {
      // We might be connected to a server that doesn't support the
      // 'STAT' command, which is set as default. We use 'LIST' instead,
      // and we set the variable `useList` to true, to avoid extra round
      // trips to the server to check.
      if ((err && (err.code === 502 || err.code === 500)) ||
        (self.system && self.system.indexOf("hummingbird") > -1))
      // Not sure if the "hummingbird" system check ^^^ is still
      // necessary. If they support any standards, the 500 error
      // should have us covered. Let's leave it for now.
      {
        self.useList = true;
        self.list(filePath, entriesToList);
      } else {
        entriesToList(err, data);
      }
    });
  }
};

Ftp.prototype.rename = function(from, to, callback) {
  var self = this;
  this.raw.rnfr(from, function(err, res) {
    if (err) return callback(err);
    self.raw.rnto(to, function(err, res) {
      callback(err, res);
    });
  });
};

Ftp.prototype.keepAlive = function() {
  var self = this;
  if (this._keepAliveInterval)
    vertx.cancelTimer(this._keepAliveInterval);

  this._keepAliveInterval = vertx.setPeriodic(IDLE_TIME, function () { self.raw.noop(); });
};

Ftp.prototype.destroy = function() {
  try {
      if (this._keepAliveInterval)
        vertx.cancelTimer(this._keepAliveInterval);
    
      this.removeAllListeners();
      if (this.socket) this.socket.close();
      this.socket = undefined;
      this.features = null;
      this.authenticated = false;
  } catch (ignore) {}
};