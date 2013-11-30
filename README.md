# Vert.x FTP Client

An asynchronous FTP client module for the Vert.x platform.

## Module "Types"

This module provides two different module types:
* A runnable Vert.x FTP client module, callable via the event bus.
* An "includable" JavaScript FTP client library as a CommonJS module.

## Installation

The module can be installed by calling

```javascript
vertx install mohlemeyer~ftpClient~{version} 
```

(See the Vert.x [module registry](http://modulereg.vertx.io) for the latest
available release.)

### Check the Installation by Running Integration Tests

In order to ensure that the module performs correctly in your setup you can run
the provided integration tests. The test suite needs a corresponding module
configuration in JSON format:

```javascript
{
    "test": true,
    "address": "ftpCl",
    "host": <Hostname or IP address {string}>,
    "port": <Portnumber {integer}>,
    "user": <username {string}>,
    "pass": <password {string}>,
    "testDir": "<name of directory to be created and deleted during the tests {string}>",
}
```

The module config needs to specify that tests should be run (`"test": true`)
and and the event bus address `ftpCl` to use for tests involving module calls
via the event bus. Apart from that you can specify host and authentication data
and you have to provide the name of a temporary remote directory , which will
be created and deleted by some of the tests. __Make sure to specify a
directory name which does not exist on the test ftp server!__ Otherwise the
tests will fail and the directory might be deleted.

The testsuite can then be started by calling

```javascript
vertx runmod mohlemeyer~ftpClient~{version} -conf {Path_to_module_configuration}
```

This might in turn install the QUnit/Sinon JavaScript testrunner for executing
the integration tests, if not already present in your local module repository.

## Usage as a Vert.x Event Bus Module

By starting the module via `vertx runmod` with a matching configuration its
functionality is exposed on the event bus. The FTP client can then be used
in two separate _modes_:
* _"One-shot"_-commands send a single FTP command to the server without any
context. All details of authentication and session management are handled by
the client.
* _Session_-commands expose an FTP session the the programmer. The session has
to be explicitly set up and discarded.

### Configuration

When running in production mode, the module has to be set up by the following
configuration:

```javascript
{
    "test": <test indicator {boolean}; MUST BE SET TO false, otherwise integration tests will be run; default is true>
    "address": <event bus address {string} for sending ftp commands>,
    "host": <FTP server {string}, optional; default is 'localhost'>,
    "port": <FTP port {integer}, optional; default is 21>
    "user": <authentication user {string}, optional; default is "anonymous">,
    "pass": <authentication password {string}, optional; default is "@anonymous">,
    "debug": <debug indicator {boolean}, optional; if true, debug messages will be published to the event bus; default is false>,
    "debugAddress": <event bus address {string} to which debug output will be published>,
    "maxSessions": <maximum number of parallel FTP sessions {integer}, optional; if not specified there is no limitation>
}
```

### "One-shot" Commands

"One-shot" commands have the following structure:

```javascript
{
    "cmd": <FTP client command {string}>,
    "args": <command arguments {array}>,
    "timeout": <max. time in ms to wait for a server response {number}; optional>
}
```

E.g. to create a directory on the server, the following command might be used:

```javascript
{
    "cmd": "mkd",
    "args": ["dirname"]
}
```

The command can then be stringified and sent to the event bus. An example in
JavaScript might look like this:

```javascript
var command = {
    cmd: 'mkd',
    args: ['dirname']
};

vertx.eventBus.send(<EB address>, JSON.stringify(command), function (replyJSON) {
    var reply = JSON.parse(replyJSON);
    if (reply.errorMsg) {
        // Handle error
        ...
    } else {
        // Handle success
        ...
    }
});
```

With "one-shot" commands host and authentication data is always taken from
the module configuration. There is no way to overwrite these options for a
single command. When running a "one-shot" command, the FTP client executes the
following steps in the background:
* Connect to the server
* Authenticate
* Send the command
* Prepare the reply
* Send the FTP `quit` command to the server
* Disconnect from the server

Each `vertx.eventBus.send` call can be provided with a reply handler, which -
in many cases (exceptions will be documented below) - receives a JSON message
of the form

```javascript
{
    "code": <(server) reply code {integer}>,
    "text": <(server) reply message {string}>,
    "data": <base64 encoded transfer data, if any {string}>
}
```

In case of an error the reply message will have the form

```javascript
{
    "errorMsg": <error message {string}>
}
```

##### When to Use "One-shot" Commands

The use of "one-shot" commands should be considered if your application makes
sparse, infrequent calls to a single FTP server. Since for each command a server
connection is established and discarded after command execution sending multiple
subsequent commands is inefficient and slow. In this case you should rather use
FTP sessions. The advantage of "one-shot" commands lies in their easy of
use: After starting up the module single FTP commands can be executed from
anywhere in your code with minimal set up an tear down effort.

### Working with FTP-Sessions

Managing FTP sessions takes a little more effort on behalf of the programmer,
although the overall code structure is the same as for "one-shot" commands.

The first step to create a session is to send the `connect` command on the
event bus. Without any arguments host and authentication data is taken from the
module configuration. But you can also provide a configuration object with 
`host`, `port`, `user` and `pass` properties as the first and only entry in an
arguments array to the `connect` command, so multiple FTP sessions with
different hosts and/or users are possible.

Here is a JavaScript example of the `connect` command:

```javascript
var command = {
        cmd: 'connect',
        args: [{
            "host": "example.host.com",
            "port": 21,
            "user": "John Doe",
            "pass": "eodnhoj"
        }],
        timeout: 2500
};

vertx.eventBus.send(<EB address>, JSON.stringify(command), function (replyJSON) {
    var reply = JSON.parse(replyJSON);
    if (reply.errorMsg) {
        // Handle connection/authentication/timeout error
        ...
    } else {
        // reply.sessionId now contains the FTP session id
        ...
    }
});
```

For all subsequent commands in the same session the session id retrieved by the
`connect` command has to be provided as an argument. Actually it is the
`sessionId` property that distinguishes session commands from "one-shot"
commands.

Here is the "make directory" example from above in a session context:

```javascript
var command = {
    cmd: 'mkd',
    args: ['dirname'],
    sessionId: <FTP session id from "connect">
};

vertx.eventBus.send(<EB address>, JSON.stringify(command), function (replyJSON) {
    var reply = JSON.parse(replyJSON);
    if (reply.errorMsg) {
        // Handle error
        ...
    } else {
        // Handle success
        ...
    }
});
```

Note that the programmer is responsible for destroying the session when it is
no longer needed. Otherwise the connection to the server is never closed by the
client. Destroying the session is performed by the `disconnect` command, which
takes the session id as its only argument. Here is a JavaScript example:

```javascript
var command = {
        cmd: 'disconnect',
        sessionId: <FTP session id from "connect">
};

vertx.eventBus.send(<EB address>, JSON.stringify(command), function (replyJSON) {
    var reply = JSON.parse(replyJSON);
    if (reply.errorMsg) {
        // Handle "disconnect error"
        ...
    }
});
```

### Command Set

#### "Raw" FTP commands

The FTP module provides most of the common "raw" FTP commands like `pwd`,
`cwd`, `dele` etc. Not all of these make sense in the context of this module.
E.g. `cwd` has no effect as a "one-shot" command, since the connection is
closed after command execution and a new context with the root of the directory
structure as the current working directory is created for the next "one-shot"
command. Likewise the `user` and `pass` commands are not required because
authentication is handled automatically in the case of "one-shot" commands and
by the `connect` directive when FTP sessions are used.

Arguments are always provided as an array of strings in the `args` property of
the command JSON representation. For commands without arguments the property
might be missing. Here are a few examples:

A command without parameters in a session context:
```javascript
{
    "cmd": "cdup",
    "sessionId": <FTP session id from "connect">
}
```
A "one-shot" command with single parameter:
```javascript
{
    "cmd": "dele",
    "args": [<Path to file on the server>]
}
```

For raw commands the response structure conforms to standard already documented 
above:

```javascript
{
    "code": <(server) reply code {integer}>,
    "text": <(server) reply message {string}>
}
```

Here is a list of all raw commands available:
`pwd`, `cdup`, `feat`, `noop`, `pasv`, `syst`, `cwd`, `dele`, `mdtm`, `mkd`,
`mode`, `rmd`, `rnfr`, `rnto`, `site`, `stat`, `type`, `opts`, `size`

### Compound commands

In addition to raw commands the FTP client provides some compound which are
required for more complex operations.

#### ls
 
The `ls` command takes a directory name as a single argument. The reply handler
receives an array of file data objects in return with properties like `name`,
`type`, `time`, `size` plus owner and permission information. Here is a
JavaScript example:

```javascript
var command = {
        cmd: 'ls',
        args: ['.']
};
    
vertx.eventBus.send(<EB address>, JSON.stringify(command), function (replyJSON) {
    var reply = JSON.parse(replyJSON);
    
    if (reply.errorMsg) {
        // Handle error
        ...
    } else {
        // reply.length corresponds to the number of file entries;
        // reply[0].name contains the name of the first file entry;
        // reply[1].size contains the size of the second file entry;
        ...
    }
});
```

#### list

The `list` command also takes a directory name as an argument. In this
case the reply hander is called with single multi-line string containing one
file entry per line. The JSON parsed reply might look something like this:

```javascript
-rw-r-----    1 ftp      ftp            32 Nov 25 11:05 myFile1.txt
-rw-r-----    1 ftp      ftp            32 Nov 25 11:05 myFile2.txt
```

#### get

The `get` command retrieves a file from the server. It can be called with one
or two arguments. The first argument is always interpreted as a complete path
to the file to be retrieved from the server.

When called with a single argument, the file content is retrieved as a Base64
encoded string. Here is a JavaScript example:

```javascript
var command = {
        cmd: 'get',
        args: [<Path to file to be retrieved>]
};
    
vertx.eventBus.send(<EB address>, JSON.stringify(command), function (replyJSON) {
    var reply = JSON.parse(replyJSON);
    var dataBuf;    // Vert.x Buffer with file contents
    
    if (reply.errorMsg) {
        // Handle error
        ...
    } else {
        // Successfully retrieved
        dataBuf = new vertx.Buffer(Packages.javax.xml.bind.DatatypeConverter.parseBase64Binary(reply.data));
    }
});
```

When called with two arguments the second argument is interpreted as a path to
a file in the local file system of the verticle running the FTP client, to
which the file content will be written. Note that - when running in cluster - 
the calling verticle and the receiving FTP client verticle might see different
file systems!

#### put

The `put` command writes a file on the server, either from Base64 encoded
string in memory or from a file in the file system. The command always takes
two arguments. The second argument is always interpreted as the complete path
to the file to be created on the server.

When the first argument is an __array__, the first array entry is interpreted as a
Base64 encoded string. Here is a JavaScript example:

```javascript
var command = {
        cmd: 'put',
        args: []
};
var fileContentsBuf = new vertx.Buffer(<File contents, e.g. as a string>);
var fileContentsBase64 = Packages.javax.xml.bind.DatatypeConverter.printBase64Binary(fileContentsBuf.getBytes());
    
command.args.push([fileContentsBase64]);
command.args.push(<Path to file on the server>);
    
vertx.eventBus.send(<EB address>, JSON.stringify(command), function (replyJSON) {
    var reply = JSON.parse(replyJSON);
        
    if (reply.errorMsg) {
        // Handle error
        ...
    } else {
        // File successfully written
        ...
    }
});
```

When the first argument is a __string__, it is interpreted as a path to a file
in the _local filesystem of the verticle running the ftp client_!

#### rename

The `rename` command takes two file names as arguments. It renames or moves a
file on the server. Here is a JavaScript example:

```javascript
var command = {
        cmd: 'rename',
        args: [<Path to "from" file name>, <Path to "to" file name>]
};

vertx.eventBus.send(<EB address>, JSON.stringify(command), function (replyJSON) {
    var reply = JSON.parse(replyJSON);
    
    if (reply.errorMsg) {
        // Handle error
        ...
    } else {
        // Successfully renamed
        ...
    }
});
```

#### keepAlive

The `keepAlive` directive instructs the client to send `noop` commands to the
server in regular intervals of 30 seconds to keep the connection open.
`keepAlive` does not take any arguments and is only allowed in a session
context.

### Shortcomings

The current FTP client implementation as Vert.x module has at least one notable
shortcoming: If you want to safely execute `get` and `put` commands over the
event bus, you have to work with Base64 strings in memory which will be
transferred between the calling verticle and the verticle running the FTP
client. For large files this might create an intolerable overhead: E.g. for a
`put` command the file data has to be created in memory, be converted to a
Base64 encoded string, then converted into a JSON structure and finally be sent
over the event bus, which will copy the JSON data. On the FTP client verticle
the data has to be JSON parsed, Base64 decoded and finally be transferred to
the FTP server.

### Debugging the Client-Server Communication

When you set the `debug` property to `true` and supply a `debugAddress`
property in your module configuration you can "listen" to the client-server
communication for debugging purposes on the supplied event bus address:

```javascript
vertx.eventBus.registerHandler(<Debug event bus address>, function (dbgOutput) {
    console.log('DBG: ' + dbgOutput);
});
```

### Examples

Examples for usage as an event bus module can be found under
`jslibs/jsftp/test/iTest_jsftpEBOneShot.js` for "one-shot" commands and
`jslibs/jsftp/test/iTest_jsftpEBSession.js` for use in a session context. 

## Using the JavaScript Event Bus Wrapper

The Vert.x module can generally be called via the event bus from verticles in
any language. For JavaScript exists a small wrapper module which encapsulates
the event bus messaging and works with promises from
[when.js](https://github.com/cujojs/when) for a clean and intuitive
programming style. Here is an example, where the FTP client first connects
to the server, then creates a directory, changes the working directory, creaates
a file and then disconnects. On top of that some extended features of when.js,
like `otherwise` and `ensure`, allow for nice error handling:

```javascript
var DatatypeConverter = Packages.javax.xml.bind.DatatypeConverter;

var FtpEbCl = require('jslibs/jsftp/lib/jsftpEBClient');
var cl = new FtpEbCl(<EB address>);
cl.setTimeout(1000);

cl.connect().
then(
        function (reply) {
            // Connected
            
            return cl.mkd('dir1');
        }
).
then(
        function (reply) {
            // Directory created
            
            return cl.cwd('dir1');
        }
).
then(
        function (reply) {
            // Working directory changed
            
            // Increase the timeout for file transfer
            cl.setTimeout(5000);
            
            var fileContentsBuf = new vertx.Buffer('abc');
            var fileContentsBase64 = DatatypeConverter.printBase64Binary(fileContentsBuf.getBytes());
            return cl.put([fileContentsBase64], 'f.txt');
        }
).
then(
        function (reply) {
            // File created
            ...
            
            // Reset the timeout value
            cl.setTimeout(1000);
        }
).
otherwise(
        function (errMsg) {
            // An error occurred somewhere in the command chain above
            ...
        }
).ensure(
        function () {
            if (cl.isConnected()) {
                cl.disconnect().
                then(
                        function (reply) {
                            // Successfully disconnected
                            ...
                        },
                        function (discErrMsg) {
                            // Error on disconnecting
                            ...
                        }
                );
            }
        }
);
```

In order to use the the JS wrapper the Vert.x module first has be be included
in your `mod.json` description. The wrapper itself is a CommonJS module, which
has to be included in your JavaScript by

```javascript
var FtpEbCl = require('jslibs/jsftp/lib/jsftpEBClient');
```

A new FTP client can then be created by specifying the event bus address of
the (started) FTP module:

```javascript
var cl = new FtpEbCl(<EB address>);
```

I.e. you may start your Vert.x FTP client verticle to listen on the event bus
as described above. Then, in a different JavaScript verticle you can use the
wrapper to call the client verticle without assembling event bus messages.
Instead you can use a promised based API to to the work for you.

### Setting a Timeout

You can optionally specify a timeout value in ms for the wrapped FTP client by
calling `cl.setTimeout(<max. time for server response>)`.
This value will be used for all subsequently issued commands of the client.
If you have commands with different timeout needs you will have to set and
reset the value before the next command as in the example above.

In order to remove the timeout simply call the `setTimeout` method with
no arguments.

### Command Set

All commands available via the event bus are available as methods of the
wrapped FTP client. The arguments array for the event bus messages are
transformed into a regular set of arguments for the individual API methods
(see the example above). Each method returns a promise, for which the resolved
handler is called with the same reply as the corresponding event bus message
and the rejected handler is called with an error message (string).

__Example:__ The command to connect to an FTP server is `cl.connect();`.
Optionally you can pass in a host/user object to specify  server and
authentication data if you want to override the host/user configured for
the client verticle:

```javascript
cl.connect({host: 'example.host.com', port: 21, user: 'John Doe', pass: 'eodnhoj'}).
then(
        /*
         * Resolved handler
         */
        function (reply) {
            // Handle success
            ...
        },
        
        /*
         * Rejected handler
         */
        function (errorMsg) {
            // Handle error
            ....
        }
);
```

The wrapped client provides one additional command to check if a client is
currently connected: `cl.isConnected()` returns a boolean value.

It is also possible to use the wrapped FTP client without first connecting to
the FTP server. In this case "one-shot" command will be issued with the same
limitations cited above.

### Examples

An examples for using the event bus wrapper can be found in
`jslibs/jsftp/test/iTest_jsftpEBWrapperSession.js`. 

### when.js

The currently bundled version of [when.js](https://github.com/cujojs/when)
is 2.6.0.

## Using the Original CommonJS Module without the Event Bus

The original FTP client implementation is a port of the
[jsftp](https://github.com/sergi/jsftp) node.js module to the Vert.x platform.
As such the Vert.x module can also be included to use the JavaScript FTP
client directly as a CommonJS module.

The following documentation is directly taken from
[jsftp](https://github.com/sergi/jsftp), with small adjustments.

### Starting it up

```javascript
var JSFtp = require("jslibs/jsftp/lib/jsftp");

var Ftp = new JSFtp({
  host: "myserver.com",
  port: 3331, // defaults to 21
  user: "user", // defaults to "anonymous"
  pass: "1234" // defaults to "@anonymous"
});
```

jsftp gives you access to all the raw commands of the FTP protocol in form of
methods in the `Ftp` object. It also provides several convenience methods for
actions that require complex chains of commands (e.g. uploading and retrieving
files, passive operations), as shown below.

When raw commands succeed they always pass the response of the server to the
callback, in the form of an object that contains two properties: `code`, which
is the response code of the FTP operation, and `text`, which is the complete
text of the response.

Raw (or native) commands are accessible in the form
`Ftp.raw["command"](params, callback)`

Thus, a command like `QUIT` will be called like this:

```javascript
Ftp.raw.quit(function(err, data) {
    if (err) return console.error(err);

    console.log("Bye!");
});
```

and a command like `MKD` (make directory), which accepts parameters, looks like
this:

```javascript
Ftp.raw.mkd("/new_dir", function(err, data) {
    if (err) return console.error(err);

    console.log(data.text); // Show the FTP response text to the user
    console.log(data.code); // Show the FTP response code to the user
});
```

### API and examples

#### new Ftp(options)
  - `options` is an object with the following properties:

  ```javascript
  {
    host: 'localhost', // Host name for the current FTP server.
    port: 3333, // Port number for the current FTP server (defaults to 21).
    user: 'user', // Username
    pass: 'pass', // Password
  }
  ```

Creates a new Ftp instance with the following properties:

#### Ftp.host

Host name for the current FTP server.

#### Ftp.port

Port number for the current FTP server (defaults to 21).

#### Ftp.socket

Client socket for the current FTP connection.

#### Ftp.features

Array of feature names for the current FTP server. It is
generated when the user authenticates with the `auth` method.

#### Ftp.system

Contains the system identification string for the remote FTP server.

### Methods

#### Ftp.raw.FTP_COMMAND([params], callback)
All the standard FTP commands are available under the `raw` namespace. These
commands might accept parameters or not, but they always accept a callback
with the signature `err, data`, in which `err` is the error response coming
from the server (usually a 4xx or 5xx error code) and the data is an object
that contains two properties: `code` and `text`. `code` is an integer indicating
the response code of the response and `text` is the response string itself.

#### Ftp.auth(username, password, callback)
Authenticates the user with the given username and password. If null or empty
values are passed for those, `auth` will use anonymous credentials. `callback`
will be called with the response text in case of successful login or with an
error as a first parameter.

#### Ftp.ls(filePath, callback)
Lists information about files or directories and yields an array of file objects
with parsed file properties to the `callback`. You should use this function
instead of `stat` or `list` in case you need to do something with the individual
file properties.

```javascript
ftp.ls(".", function(err, res) {
  res.forEach(function(file) {
    console.log(file.name);
  });
});
```

#### Ftp.list(filePath, callback)
Lists `filePath` contents using a passive connection. Calls callback with a
multi-line string with complete file information.

```javascript
ftp.list(remoteCWD, function(err, listing) {
  console.log(listing);
  // Prints something like
  // -rw-r--r--   1 sergi    staff           4 Jun 03 09:32 testfile1.txt
  // -rw-r--r--   1 sergi    staff           4 Jun 03 09:31 testfile2.txt
  // -rw-r--r--   1 sergi    staff           0 May 29 13:05 testfile3.txt
  // ...
});
```

#### Ftp.get(remotePath, callback)
Gives back a paused socket with the file contents ready to be streamed,
or calls the callback with an error if not successful.

```javascript
ftp.get(<test file name>, function(err, socket) {
    var buffer = new vertx.Buffer();

    if (err) {
        // Handle error retrieving the file
        ...
    } else {
        socket.dataHandler(function(buf) {
            buffer.appendBuffer(buf);
        });
        socket.exceptionHandler(function (err) {
            // Handle socket error retrieving the file
        });
        socket.endHandler(function() {
            socket.close();
            // "buffer" has now the complete file contents
            ... 
        });
        socket.resume();
    }
});
```

#### Ftp.get(remotePath, localPath, callback)
Stores the remote file directly in the given local path.

```javascript
  ftp.get('remote/file.txt', 'local/file.txt', function(hadErr) {
    if (hadErr)
      console.error('There was an error retrieving the file.');
    else
      console.log('File copied successfully!');
  });
```

#### Ftp.put(source, remotePath, callback)
Uploads a file to `filePath`. It accepts a string with the local path for the
file or a Vert.x `Buffer` as a `source` parameter.

```javascript
ftp.put(buffer, 'path/to/remote/file.txt', function(hadError) {
  if (!hadError)
    console.log("File transferred successfully!");
});
```

#### Ftp.rename(from, to, callback)
Renames a file on the server. `from` and `to` are both filepaths.

```javascript
ftp.rename(from, to, function(err, res) {
  if (!err)
    console.log("Renaming successful!");
});
```

#### Ftp.keepAlive()
Instructs the client to send `noop` commands to the server in regular intervals
of 30 seconds to keep the connection open.

### Examples

Usage examples can be found in the integration tests under
`jlibs/jsftp/test/iTest_jsftp.js`.

## Credits
The `jsftp.js` library under `jslibs/jsftp/lib` is derived from the file of the
same name in the node.js [jsftp](https://github.com/sergi/jsftp) library. The
effort here is a port to the Vert.x platform and an adaption to the Vert.x
event bus infrastructure. 

## License

See the LICENSE file under `jslibs/jsftp`.
