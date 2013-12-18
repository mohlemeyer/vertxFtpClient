/**
 * QUnit tests for ftpClient
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
require('jslibs/qunit/qunit/qunitContext')(this);
var vertx = require('vertx');

var container = require('vertx/container');
var Ftp = require("jslibs/jsftp/lib/jsftp");

var ftpClientConfig;
var ftpClient;
var ftpClientErrorHandler;
var ftpClientUnauth;
var testFileContents = 'This should go to the test file!';
var testFileName = 'myFile.txt';
var testFileName2 = 'myFile2.txt';
var testFileName3 = 'myFile3.txt';
var expectedFileSize;
var nestedDirName = 'subDir';

//Prepare ftp client with automatic authentication
ftpClientConfig = {
        host: 'localhost'
};
if (container.config) {
    if (container.config.host) ftpClientConfig.host = container.config.host;
    if (container.config.port) ftpClientConfig.port = container.config.port;
    if (container.config.user) ftpClientConfig.user = container.config.user;
    if (container.config.pass) ftpClientConfig.pass = container.config.pass;
}
ftpClient = new Ftp(ftpClientConfig);

ftpClientErrorHandler = function (errorData) {
    console.log('FTP client error: ' + errorData);
};
ftpClient.on('error', ftpClientErrorHandler);

//Do not test if no test directory specified
if (!container.config || !container.config.testDir) {
    throw new Error('Test directory on ftp server not specified in config.');
}

//==========================================================================
QUnit.module('jsftp');
//==========================================================================

asyncTest('should create test directory', function () {
    ftpClient.raw.mkd(container.config.testDir, function (err, data) {
        if (err) {
            console.log(err);
            ok(false, 'Test directory created');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should change working directory', function () {
    ftpClient.raw.cwd(container.config.testDir, function (err, data) {
        if (err) {
            ok(false, 'Working directory changed');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should create file from buffer', function () {
    var b = new vertx.Buffer(testFileContents);
    expectedFileSize = b.length();
    ftpClient.put(b, testFileName, function (err, data) {
        if (err) {
            ok(false, 'File created');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should list the file', function () {
    ftpClient.ls('.', function(err, dirContents) {
        if (err) {
            ok(false, 'File listing with ls');
        } else {
            equal(dirContents.length, 1, 'Directory contains one entry');
            equal(dirContents[0].name, testFileName, 'File is listed');
            equal(dirContents[0].size, expectedFileSize, 'File has expected size');
        }
        start();
    });
});

asyncTest('should rename the file', function () {
    ftpClient.rename(testFileName, testFileName2,  function(err, data) {
        if (err) {
            ok(false, 'File renamed');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should create a nested directory', function () {
    ftpClient.raw.mkd(nestedDirName, function (err, data) {
        if (err) {
            ok(false, 'Nested directory created');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should move the file', function () {
    ftpClient.rename(testFileName2, nestedDirName + '/' + testFileName2,  function(err, data) {
        if (err) {
            ok(false, 'File moved');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should change working directory to nested directory', function () {
    ftpClient.raw.cwd(nestedDirName, function (err, data) {
        if (err) {
            ok(false, 'Working directory changed');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should retrieve file over socket', function () {
    ftpClient.get(testFileName2, function(err, socket) {
        var buffer = new vertx.Buffer();

        if (err) {
            ok(false, 'Retrieving file over socket');
        } else {
            socket.dataHandler(function(buf) {
                buffer.appendBuffer(buf);
            });
            socket.exceptionHandler(function (err) {
                ok(false, 'Socket error');
                start();
            });
            socket.endHandler(function() {
                socket.close();
                equal(buffer.length(), expectedFileSize, 'Buffer has expected length');
                equal(buffer.toString(), testFileContents, 'Buffer contains test file contents');
                start();
            });
            socket.resume();
        }
    });
});

asyncTest('should copy file from ftp server to file system', function () {
    ftpClient.get(testFileName2, testFileName2, function(err) {
        if (err) {
            ok(false, 'Retrieving file to file system');
        } else {
            vertx.fileSystem.readFile(testFileName2, function(error, buf) {
                if (error) {
                    ok(false, 'Reading copied file from file system');
                } else {
                    equal(buf.toString(), testFileContents, 'Copied file contains expected contents');
                }
                start();
            });
        }
    });
});

asyncTest('should copy file from file system to ftp server', function () {
    ftpClient.put(testFileName2, testFileName, function (err, data) {
        if (err) {
            ok(false, 'Copying file to ftp server');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }

        // Cleanup file system
        try {
            vertx.fileSystem.deleteSync(testFileName2);
        } catch (ignore) {}

        start();
    });
});

asyncTest('copied file should have the same contents', function () {
    ftpClient.get(testFileName, function(err, socket) {
        var buffer = new vertx.Buffer();

        if (err) {
            ok(false, 'Retrieving file over socket');
            console.log(err);
            start();
        } else {
            socket.dataHandler(function(buf) {
                buffer.appendBuffer(buf);
            });
            socket.exceptionHandler(function (err) {
                ok(false, 'Socket error');
                start();
            });
            socket.endHandler(function() {
                socket.close();
                equal(buffer.length(), expectedFileSize, 'Buffer has expected length');
                equal(buffer.toString(), testFileContents, 'Buffer contains test file contents');
                start();
            });
            socket.resume();
        }
    });
});

asyncTest('should stream file to ftp server', function () {
    vertx.fileSystem.open(testFileName2, function(openErr, asyncFileStream) {
        if (openErr) {
            ok(false, 'Could not open file');
        } else {
            ftpClient.put(asyncFileStream, testFileName3, function (err, data) {
                if (err) {
                    ok(false, 'Copying file to ftp server');
                } else {
                    ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
                }

                // Cleanup file system
                try {
                    asyncFileStream.close();
                    vertx.fileSystem.deleteSync(testFileName2);
                } catch (ignore) {}

                start();
            });
        }
    }); 
});

asyncTest('should change working directory to parent directory', function () {
    ftpClient.raw.cdup(function (err, data) {
        if (err) {
            ok(false, 'Changed to parent directory');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should delete the test file', function () {
    ftpClient.raw.dele(nestedDirName + '/' + testFileName2, function (err, data) {
        if (err) {
            ok(false, 'Test file deleted');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should delete the file copied from the file system', function () {
    ftpClient.raw.dele(nestedDirName + '/' + testFileName, function (err, data) {
        if (err) {
            ok(false, 'Test file deleted');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should delete the streamed file', function () {
    ftpClient.raw.dele(nestedDirName + '/' + testFileName3, function (err, data) {
        if (err) {
            ok(false, 'Test file deleted');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should delete the nested directory', function () {
    ftpClient.raw.rmd(nestedDirName, function (err, data) {
        if (err) {
            ok(false, 'Nested directory deleted');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should delete the test directory', function () {
    ftpClient.raw.rmd('/' + container.config.testDir, function (err, data) {
        if (err) {
            ok(false, 'Test directory deleted');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should quit', function () {
    var started = false;

    // Remove the general error handler
    ftpClient.off('error', ftpClientErrorHandler);

    // Quitting might lead to a closed connection from the remote host before
    // the data code 221 is received by the client, so be sure to catch the
    // emitted error
    ftpClient.once('error', function () {
        if (!started) {
            ok(true);
            started = true;
            start();
        }            
    });
    ftpClient.raw.quit(function (err, data) {
        if (err) {
            ok(false, 'Quitting');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        if (!started) {
            started = true;
            start();
        }
    });
});

//Tests for client with explicit authentication
ftpClientUnauth = new Ftp({ host: ftpClientConfig.host });
ftpClientUnauth.on('error', ftpClientErrorHandler);

asyncTest('should authenticate', function (err) {
    ftpClientUnauth.auth(ftpClientConfig.user, ftpClientConfig.pass, function(err, data) {
        if (err) {
            ok(false, 'Authenticating');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should create file from buffer', function () {
    var b = new vertx.Buffer(testFileContents);
    expectedFileSize = b.length();
    ftpClientUnauth.put(b, testFileName, function (err, data) {
        if (err) {
            ok(false, 'File created');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should create a second file from buffer', function () {
    var b = new vertx.Buffer(testFileContents);
    expectedFileSize = b.length();
    ftpClientUnauth.put(b, testFileName2, function (err, data) {
        if (err) {
            ok(false, 'File created');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should retrieve directory listing in parallel with ls', function () {
    var started = false;
    
    ftpClientUnauth.ls(testFileName, function (err, files) {
        if (err) {
            ok(false, 'Directory listing');
        } else {
            equal(files[0].name, testFileName, 'First file found');
        }
        if (!started) {
            started = true;
            start();
        }
    });
    ftpClientUnauth.ls(testFileName2, function (err, files) {
        if (err) {
            ok(false, 'Directory listing');
        } else {
            equal(files[0].name, testFileName2, 'Second file found');
        }
        if (!started) {
            started = true;
            start();
        }
    });
});

asyncTest('should retrieve directory listing with list', function () {
    ftpClientUnauth.list('.', function(err, listing) {
        if (err) {
            ok(false, 'Retrieve directory listing');
        } else {
            ok(listing.indexOf(testFileName) > -1, 'listing contains file name');
        }
        start();
    });
});

asyncTest('should delete first file', function () {
    ftpClientUnauth.raw.dele(testFileName, function (err, data) {
        if (err) {
            ok(false, 'Test file deleted');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});

asyncTest('should delete second file', function () {
    ftpClientUnauth.raw.dele(testFileName2, function (err, data) {
        if (err) {
            ok(false, 'Test file deleted');
        } else {
            ok(data.code >=200 && data.code < 300, 'Got "success" reply code: ' + data.code);
        }
        start();
    });
});
