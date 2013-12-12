#!/usr/bin/env node

var
	net = require('net'),
	stdin = process.openStdin(),
	SecretAgent = require('../lib/secretagent'),
	name = process.argv[2],
	listenPort = parseInt(process.argv[3]),
	connectTo = [],
	secretagent;

if ( !name )
	throw Error("No name");
if ( !listenPort )
	throw Error("No listen port");

// Connect to somewhere ?
for ( var x = 4 ; x < process.argv.length ; x++ ) {
	var
		connectHost = process.argv[x] ? process.argv[x].replace(/:.*$/,"") : null,
		connectPort = process.argv[x] ? parseInt(process.argv[x].replace(/^[^:]+:?/,"")) : null;
	connectTo.push({host: connectHost, port: connectPort});
}


// Create the secretagent
secretagent = new SecretAgent(name.toUpperCase(),{DEBUG:10});
secretagent.on('message',function(message,from,to,directFrom){
	console.log("Got a message for me (from "+from+", direct from: "+directFrom+"): ",message);
});

// Create server
secretagent.createServer(listenPort);

// Connect to remove server
if ( connectTo.length > 0 ) {
	connectTo.forEach(function(dest){
		secretagent.connect(dest.port,dest.host);
	});
}

// Read events from keyboard
process.stdin.setRawMode(true);
var next = null;
stdin.on('data', function (key) {

	if ( next == "disconnect_server" ) {
		if ( key[0] >= 48 && key[0] <= 57 ) {
			console.log("Disconnecting server client "+parseInt(key[0]-48)+"...");
			try {
				secretagent._serverClients[parseInt(key[0]-48)].disconnect();
			}
			catch(ex){
				console.log("Failed: ",ex);
			}
			next = null;
			return;
		}
	}
	else if ( next == "disconnect_client" ) {
		if ( key[0] >= 48 && key[0] <= 57 ) {
			console.log("Disconnecting client server "+parseInt(key[0]-48)+"...");
			try {
				secretagent._clientServers[parseInt(key[0]-48)].disconnect();
			}
			catch(ex){
				console.log("Failed: ",ex);
			}
			next = null;
			return;
		}
	}
	else if ( next == "connect_client" ) {
		if ( key[0] >= 48 && key[0] <= 57 ) {
			console.log("Connecting to client server "+parseInt(key[0]-48)+"...");
			try {
				var dest = connectTo[parseInt(key[0]-48)];
				secretagent.connect(dest.port,dest.host);
			}
			catch(ex){
				console.log("Failed: ",ex);
			}
			next = null;
			return;
		}
	}
	else if ( next == "sendmessage" ) {
		if ( key[0] >= 97 && key[0] <= 122 ) {
			var who = String.fromCharCode(key[0]).toUpperCase();
			console.log("Sending message to '"+who+"'...");
			next = null;
			return secretagent.sendMessage(who,"Hello sir!");
		}
	}

	// m (message)
	if (key[0] == 109) {
		next = "sendmessage";
		setTimeout(function(){ next = null },1500);
	}
	else if ( key[0] == 97 ) {
		console.log("Network:",require('util').inspect(secretagent._membersIKnow,{depth:5}));
	}
	else if ( key[0] == 99 ) {
		next = "connect_client";
		setTimeout(function(){ next = null },1500);
	}
	// d (disconnect)
	else if ( key[0] == 100 ) {
		next = "disconnect_server";
		setTimeout(function(){ next = null },1500);
	}
	// D (disconnect client)
	else if ( key[0] == 68 ) {
		next = "disconnect_client";
		setTimeout(function(){ next = null },1500);
	}
	// Enter
	else if ( key[0] == 13 || key[0] == 10 ) {
		console.log("");
	}
	// Control+C
	else if (key[0] == 3) process.exit();
});
