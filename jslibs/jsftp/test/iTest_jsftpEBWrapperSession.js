/**
 * QUnit integration tests of the JavaScript Wrapper for the ftpClient over
 * the event bus with FTP session use
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
require('jslibs/qunit/qunit/qunitContext')(this);
var vertx = require('vertx');

var container = require('vertx/container');

require("jslibs/jsftp/lib/jsftpEB");
var FtpEbCl = require('jslibs/jsftp/lib/jsftpEBClient');

var DatatypeConverter = Packages.javax.xml.bind.DatatypeConverter;

var testFileContents = 'This should go to the test file!';
var testFileName = 'myFile.txt';
var testFileName2 = 'myFile2.txt';
var nestedDirName = 'subDir';

//==========================================================================
QUnit.module('a-ftpClient.EventBusWrapper.FtpSession');
//==========================================================================

var cl = new FtpEbCl('ftpCl');
cl.setTimeout(5000); // Set standard timeout

asyncTest('should run all integration tests', function () {
    cl.connect().
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Connected successfully: ' + reply.code);
                return cl.mkd(container.config.testDir);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Directory created successfully: ' + reply.code);
                return cl.cwd(container.config.testDir);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Directory changed successfully: ' + reply.code);
                return cl.pwd();
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Directory printed successfully: ' + reply.code);
                ok(reply.text.indexOf(container.config.testDir) > -1, 'Reply contains the name of the current working directory');
                
                var fileContentsBuf = new vertx.Buffer(testFileContents);
                var fileContentsBase64 = DatatypeConverter.printBase64Binary(fileContentsBuf.getBytes());
                
                cl.setTimeout(10000); // Increase timeout
                return cl.put([fileContentsBase64], testFileName);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'File created successfully: ' + reply.code);
                
                cl.setTimeout(5000); // Reset timeout
                return cl.ls('.');
            }
    ).
    then(
            function (reply) {
                strictEqual(reply.length, 1, 'one entry in file list');
                strictEqual(reply[0].name, testFileName, 'correct entry in file list');
                return cl.rename(testFileName, testFileName2);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'File renamed successfully: ' + reply.code);
                return cl.mkd(nestedDirName);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Nested directroy created successfully: ' + reply.code);
                return cl.rename(testFileName2, nestedDirName + '/' + testFileName2);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'File moved successfully: ' + reply.code);
                return cl.cwd(nestedDirName);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Changed to nested directory successfully: ' + reply.code);
                return cl.get(testFileName2);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Got file successfully into buffer: ' + reply.code);
                var dataBuf = new vertx.Buffer(DatatypeConverter.parseBase64Binary(reply.data));
                strictEqual(dataBuf.toString(), testFileContents, 'File contents ok');
                return cl.get(testFileName2, testFileName2);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Got file successfully into file system: ' + reply.code);

                var buf = vertx.fileSystem.readFileSync(testFileName2);
                equal(buf.toString(), testFileContents, 'Copied file contains expected contents');

                return cl.put(testFileName2, testFileName);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Put file successfully onto the FTP server: ' + reply.code);

                // Cleanup file system
                try {
                    vertx.fileSystem.deleteSync(testFileName2);
                } catch (ignore) {}

                return cl.cdup();
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Changed one directory level up successfully: ' + reply.code);
                return cl.dele(nestedDirName + '/' + testFileName2);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'File 2 deleted successfully: ' + reply.code);
                return cl.dele(nestedDirName + '/' + testFileName);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'File deleted successfully: ' + reply.code);
                return cl.rmd(nestedDirName);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Nested directroy deleted successfully: ' + reply.code);
                return cl.cdup();
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Directory changed up successfully: ' + reply.code);
                return cl.rmd(container.config.testDir);
            }
    ).
    then(
            function (reply) {
                ok(typeof reply.code === 'number' &&
                        reply.code >=200 && reply.code < 300, 'Directory removed successfully: ' + reply.code);
            }
    ).
    otherwise(
            function (errMsg) {
                ok(false, 'An error occurred: ' + errMsg);
            }
    ).
    ensure(
            function () {
                if (cl.isConnected()) {
                    cl.disconnect().
                    then(
                            function (reply) {
                                ok(typeof reply.code === 'number' &&
                                        reply.code >=200 && reply.code < 300, 'Disconnected successfully: ' + reply.code);
                                start();
                            },
                            function (discErrMsg) {
                                ok(false, 'Error disconnecting: ' + discErrMsg);
                                start();
                            }
                    );
                } else {
                    ok(false, 'Not connected => not disconnecting');
                    start();
                }
            }
    );
});
