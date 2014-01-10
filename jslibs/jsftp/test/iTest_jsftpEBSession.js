/**
 * QUnit integration tests for ftpClient over event bus with session commands
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
require('jslibs/qunit/qunit/qunitContext')(this);
var vertx = require('vertx');

var container = require('vertx/container');
var Ftp = require("jslibs/jsftp/lib/jsftpEB");

var DatatypeConverter = Packages.javax.xml.bind.DatatypeConverter;

var testFileContents = 'This should go to the test file!';
var testFileName = 'myFile.txt';
var testFileName2 = 'myFile2.txt';
var nestedDirName = 'subDir';

var ftpSessionId;

//==========================================================================
QUnit.module('a-ftpClient.EventBus.FtpSession');
//==========================================================================

asyncTest('should connect to the ftp server', function () {
    var cmd = {
            cmd: 'connect'
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Error connecting: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
            ftpSessionId = reply.sessionId;
        }
        start();
    });
});

asyncTest('should create test directory', function () {
    var cmd = {
            cmd: 'mkd',
            args: [container.config.testDir],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Error creating test directory: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('should change working directory', function () {
    var cmd = {
            cmd: 'cwd',
            args: [container.config.testDir],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Changed working directory: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('should "print" the current working directory', function () {
    var cmd = {
            cmd: 'pwd',
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, '"Printed" working directory: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
            ok(reply.text.indexOf(container.config.testDir) > -1, 'Reply contains the name of the current working directory');
        }
        start();
    });
});

asyncTest('should create file from buffer', function () {
    var cmd = {
            cmd: 'put',
            args: [],
            sessionId: ftpSessionId
    };
    var fileContentsBuf = new vertx.Buffer(testFileContents);
    var fileContentsBase64 = DatatypeConverter.printBase64Binary(fileContentsBuf.getBytes());
    
    cmd.args.push([fileContentsBase64]);
    cmd.args.push(testFileName);
    
    vertx.eventBus.send(container.config.address, cmd, function (reply) {        
        if (reply.errorMsg) {
            ok(false, 'File created: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('should list the file', function () {
    var cmd = {
            cmd: 'ls',
            args: ['.'],
            sessionId: ftpSessionId
    };
    
    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'File listing with ls: ' + reply.errorMsg);
        } else {
            strictEqual(reply.fileList.length, 1, 'one entry in file list');
            strictEqual(reply.fileList[0].name, testFileName, 'correct entry in file list');
        }
        start();
    });
});

asyncTest('should rename the file', function () {
    var cmd = {
            cmd: 'rename',
            args: [testFileName, testFileName2],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'File renamed: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('should create a nested directory', function () {
    var cmd = {
            cmd: 'mkd',
            args: [nestedDirName],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Nested directory created: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('should move the file', function () {
    var cmd = {
            cmd: 'rename',
            args: [testFileName2, nestedDirName + '/' + testFileName2],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'File moved: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('should change working directory to nested directory', function () {
    var cmd = {
            cmd: 'cwd',
            args: [nestedDirName],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Changed working directory: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('"get" should retrieve the file into a buffer', function () {
    var cmd = {
            cmd: 'get',
            args: [testFileName2],
            sessionId: ftpSessionId
    };
    
    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        var dataBuf;
        
        if (reply.errorMsg) {
            ok(false, 'File retrieved: ' + reply.errorMsg);
            start();
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
            dataBuf = new vertx.Buffer(DatatypeConverter.parseBase64Binary(reply.data));
            strictEqual(dataBuf.toString(), testFileContents, 'File contents ok');
        }
        start();
    });
});

asyncTest('should copy file from ftp server to file system', function () {
    var cmd = {
            cmd: 'get',
            args: [testFileName2, testFileName2],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'File retrieved to filesystem: ' + reply.errorMsg);
            start();
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
    var cmd = {
            cmd: 'put',
            args: [testFileName2, testFileName],
            sessionId: ftpSessionId
    
    };
    
    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Copied file to ftp server: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        
        // Cleanup file system
        try {
            vertx.fileSystem.deleteSync(testFileName2);
        } catch (ignore) {}

        start();
    });
});

asyncTest('copied file should have the same contents', function () {
    var cmd = {
            cmd: 'get',
            args: [testFileName],
            sessionId: ftpSessionId
    };
    
    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        var dataBuf;
        
        if (reply.errorMsg) {
            ok(false, 'File retrieved: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
            dataBuf = new vertx.Buffer(DatatypeConverter.parseBase64Binary(reply.data));
            strictEqual(dataBuf.toString(), testFileContents, 'File contents ok ');
        }
        start();
    });
});

asyncTest('should change working directory to parent directory', function () {
    var cmd = {
            cmd: 'cdup',
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Changed to parent directory: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});


asyncTest('should delete the test file', function () {
    var cmd = {
            cmd: 'dele',
            args: [nestedDirName + '/' + testFileName2],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Test file  2 deleted: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('should delete the file copied from the file system', function () {
    var cmd = {
            cmd: 'dele',
            args: [nestedDirName + '/' + testFileName],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Test file deleted: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('should delete the nested directory', function () {
    var cmd = {
            cmd: 'rmd',
            args: [nestedDirName],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Nested directory deleted: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('should delete the test directory', function () {
    var cmd = {
            cmd: 'rmd',
            args: ['/' + container.config.testDir],
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Test directory deleted: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});

asyncTest('should disconnect from the ftp server', function () {
    var cmd = {
            cmd: 'disconnect',
            sessionId: ftpSessionId
    };

    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        if (reply.errorMsg) {
            ok(false, 'Error disconnecting: ' + reply.errorMsg);
        } else {
            ok(typeof reply.code === 'number' &&
                    reply.code >=200 && reply.code < 300, 'Got "success" reply code: ' + reply.code);
        }
        start();
    });
});
