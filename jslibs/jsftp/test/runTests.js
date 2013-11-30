/*jslint sloppy:true, white:true, vars:true, stupid: true */
/*global require */

/**
 * Startup script to run unit tests for ftpClient
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */

var vertx = require('vertx');
var container = require('vertx/container');
var runTests = require('jslibs/qunit/vertxTestRnr');

runTests(
		{
			startDir: '.',
			testFilePattern: '^iTest_.*\\.js$'
		},
		function (junitResult) {
			vertx.fileSystem.writeFileSync('jslibs/jsftp/test/testResult/iIest.xml', junitResult);
			container.exit();
		}
);