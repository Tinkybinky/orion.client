/*******************************************************************************
 * Copyright (c) 2012, 2013 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
/*eslint-env node, express, compression*/
var auth = require('./lib/middleware/auth'),
	express = require('express'),
	http = require('http'),
	https = require('https'),
	fs = require('fs'),
	compression = require('compression'),
	path = require('path'),
	socketio = require('socket.io'),
	util = require('util'),
	argslib = require('./lib/args'),
	ttyShell = require('./lib/tty_shell'),
	orion = require('./index.js'),
	prefs = require('./lib/controllers/prefs');

// Get the arguments, the workspace directory, and the password file (if configured), then launch the server
var args = argslib.parseArgs(process.argv);

var PORT_LOW = 8082;
var PORT_HIGH = 10082;
var port = args.port || args.p || process.env.PORT || 8081;
var configFile = args.config || args.c || path.join(__dirname, 'orion.conf');

var configParams = argslib.readConfigFileSync(configFile) || {};

function startServer(cb) {
	
	var workspaceArg = args.workspace || args.w;
	var workspaceConfigParam = configParams.workspace;
	var workspaceDir;
	if (workspaceArg) {
		// -workspace passed in command line is relative to cwd
		workspaceDir = path.resolve(process.cwd(), workspaceArg);
	} else if (workspaceConfigParam) {
		 // workspace param in orion.conf is relative to the server install dir.
		workspaceDir = path.resolve(__dirname, workspaceConfigParam);
	} else {
		workspaceDir = path.join(__dirname, '.workspace');
	}
	argslib.createDirs([workspaceDir], function() {
	var passwordFile = args.password || args.pwd;
	argslib.readPasswordFile(passwordFile, function(password) {
		var dev = Object.prototype.hasOwnProperty.call(args, 'dev');
		var log = Object.prototype.hasOwnProperty.call(args, 'log');
		if (dev) {
			console.log('Development mode: client code will not be cached.');
		}
		if (passwordFile) {
			console.log(util.format('Using password from file: %s', passwordFile));
		}
		console.log(util.format('Using workspace: %s', workspaceDir));
		
		var server;
		try {
			// create web server
			var app = express();
			if (configParams["orion.https.key"] && configParams["orion.https.cert"]) {
				server = https.createServer({
					key: fs.readFileSync(configParams["orion.https.key"]),
					cert: fs.readFileSync(configParams["orion.https.cert"])
				}, app);
			} else {
				server = http.createServer(app);
			}

			// Configure middleware
			if (log) {
				app.use(express.logger('tiny'));
			}
			if (password || configParams.pwd) {
				app.use(auth(password || configParams.pwd));
			}
			
			app.use(compression());
			app.use(orion({
				workspaceDir: workspaceDir,
				configParams: configParams,
				maxAge: dev ? 0 : undefined,
			}));
			var io = socketio.listen(server, { 'log level': 1 });
			ttyShell.install({ io: io, fileRoot: '/file', workspaceDir: workspaceDir });

			server.on('listening', function() {
				console.log(util.format('Listening on port %d...', port));
				if (cb) {
					cb();
				}
			});
			server.on('error', function(err) {
				if (err.code === "EADDRINUSE") {
					port = Math.floor(Math.random() * (PORT_HIGH - PORT_LOW) + PORT_LOW);
					server.listen(port);
				}
			});
			server.listen(port);
		} catch (e) {
			console.error(e && e.stack);
		}
	});
	});
}

if (process.versions.electron) {
	var electron = require('electron'),
		autoUpdater = electron.autoUpdater,
		spawn = require('child_process').spawn,
		os = require('os');

	configParams.isElectron = true;

	var handleSquirrelEvent = function() {
		if (process.argv.length === 1 || os.platform() !== 'win32') { // No squirrel events to handle
			return false;
		}

		var	target = path.basename(process.execPath);

		function executeSquirrelCommand(args, done) {
			var updateDotExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
			var child = spawn(updateDotExe, args, { detached: true });
			child.on('close', function() {
				done();
			});
		}

		var squirrelEvent = process.argv[1];
		switch (squirrelEvent) {
			case '--squirrel-install':
			case '--squirrel-updated':
				// Install desktop and start menu shortcuts
				executeSquirrelCommand(["--createShortcut", target], electron.app.quit);
				setTimeout(electron.app.quit, 1000);
				return true;
			case '--squirrel-obsolete':
				// This is called on the outgoing version of the app before
				// we update to the new version - it's the opposite of
				// --squirrel-updated
				electron.app.quit();
				return true;
			case '--squirrel-uninstall':
				// Remove desktop and start menu shortcuts
				executeSquirrelCommand(["--removeShortcut", target], electron.app.quit);
				setTimeout(electron.app.quit, 1000);
				return true;
		}
		return false;
	};

	if (handleSquirrelEvent()) {
		// Squirrel event handled and app will exit in 1000ms
		return;
	}

	electron.app.on('ready', function() {
		var allPrefs = prefs.readPrefs();
		var prefsWorkspace = allPrefs.user && allPrefs.user.workspace && allPrefs.user.workspace.currentWorkspace;
		if (prefsWorkspace) {
			configParams.workspace = prefsWorkspace;
		}
		if (process.platform === 'darwin') {
			var Menu = require("menu");
			if (!Menu.getApplicationMenu()) {
				var template = [{
					label: "Application",
					submenu: [
						{ label: "About Application", selector: "orderFrontStandardAboutPanel:" },
						{ type: "separator" },
						{ label: "Quit", accelerator: "Command+Q", click: function() { app.quit(); }}
					]}, {
					label: "Edit",
					submenu: [
						{ label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
						{ label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
						{ type: "separator" },
						{ label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
						{ label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
						{ label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
						{ label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" }
					]}
				];
				Menu.setApplicationMenu(Menu.buildFromTemplate(template));
			}
		}
		function createWindow(url){
			var windowOptions = allPrefs.windowBounds || {width: 1024, height: 800};
			windowOptions.title = "Orion";
			windowOptions.icon = "icon/256x256/orion.png";
			var nextWindow = new electron.BrowserWindow(windowOptions);
			nextWindow.loadURL("file:///" + __dirname + "/lib/main.html#" + encodeURI(url));
			nextWindow.webContents.on("new-window", /* @callback */ function(event, url, frameName, disposition, options){
				event.preventDefault();
				if (false === undefined) {// Always open new tabs for now
					createWindow(url);
				} else {
					nextWindow.webContents.executeJavaScript("__openFolder = require('dialog').showSaveDialog;");
					nextWindow.webContents.executeJavaScript('createTab("' + url + '");');
				}
			});
			nextWindow.on("close", function() {
				allPrefs = prefs.readPrefs();
				allPrefs.windowBounds = nextWindow.getBounds();
				prefs.writePrefs(allPrefs);
			});
			return nextWindow;
		}
		startServer(function() {
			var mainWindow = createWindow("http://localhost:" + port);
			mainWindow.on('closed', function() {
				mainWindow = null;
			});
		});
	});
	electron.app.on('window-all-closed', function() {
		electron.app.quit();	
	});
	
	// Check for updates every time we run the electron app
	var feedURL = configParams["orion.autoUpdater.url"];
	if (feedURL) {
		var platform = os.platform() + '_' + os.arch(),
		version = electron.app.getVersion();
		autoUpdater.setFeedURL(feedURL + '/' + platform + '/' + version);
		autoUpdater.checkForUpdates();
	}
	
} else {
	startServer();
}
