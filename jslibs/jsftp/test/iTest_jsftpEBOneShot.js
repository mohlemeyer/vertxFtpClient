/**
 * QUnit integration tests for ftpClient over event bus with one-shot commands
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

//==========================================================================
QUnit.module('a-ftpClient.EventBus.OneShotCommands');
//==========================================================================


asyncTest('should create test directory', function () {
    var cmd = {
            cmd: 'mkd',
            args: [container.config.testDir]
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

asyncTest('should create file from buffer', function () {
    var cmd = {
            cmd: 'put',
            args: []
    };
    var fileContentsBuf = new vertx.Buffer(testFileContents);
    var fileContentsBase64 = DatatypeConverter.printBase64Binary(fileContentsBuf.getBytes());
    
    cmd.args.push([fileContentsBase64]);
    cmd.args.push(container.config.testDir + '/' + testFileName);
    
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
            args: [container.config.testDir]
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
            args: [container.config.testDir + '/' + testFileName,
                   container.config.testDir + '/' + testFileName2]
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
            args: [container.config.testDir + '/' + nestedDirName]
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
            args: [container.config.testDir + '/' + testFileName2,
                   container.config.testDir + '/' + nestedDirName + '/' + testFileName2]
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

asyncTest('"get" should retrieve the file into a buffer', function () {
    var cmd = {
            cmd: 'get',
            args: [container.config.testDir + '/' + nestedDirName + '/' + testFileName2]
    };
    
    vertx.eventBus.send(container.config.address, cmd, function (reply) {
        var dataBuf;
        
        if (reply.errorMsg) {
            ok(false, 'File retrieved: ' + reply.errorMsg);
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
            args: [container.config.testDir + '/' + nestedDirName + '/' + testFileName2,
                   testFileName2]
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
            args: [testFileName2,
                   container.config.testDir + '/' + nestedDirName + '/' + testFileName]
    
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
            args: [container.config.testDir + '/' + nestedDirName + '/' + testFileName]
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

asyncTest('should delete the test file', function () {
    var cmd = {
            cmd: 'dele',
            args: [container.config.testDir + '/' + nestedDirName + '/' + testFileName2]
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
            args: [container.config.testDir + '/' + nestedDirName + '/' + testFileName]
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
            args: [container.config.testDir + '/' + nestedDirName]
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
            args: [container.config.testDir]
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