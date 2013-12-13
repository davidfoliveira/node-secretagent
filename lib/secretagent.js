"use strict";

/*
 * TODO:
	- Message delivery confirmation
	- Queue messages for sending until we have confirmation (the connection can go down before real sending)
	- Choose the faster/shorter way (direct or with less elements on the middle)
 */

var
	net		= require('net'),
	events		= require('events'),
	util		= require('util'),
	MessageStream	= require('./messagestream');


// SecretAgent object
function SecretAgent(name,opts){

	var
		self = this;

	// Options
	if ( !opts )
		opts = {};
	self.opts = opts;
	if ( opts.timeoutWatchInterval == null )
		opts.timeoutWatchInterval = 2000;
	if ( opts.pingAfter == null )
		opts.pingAfter = 5000;
	if ( !opts.pingTimeout )
		opts.pingTimeout = 1500;
	if ( opts.autoReconnect == null )
		opts.autoReconnect = true;
	if ( opts.autoReconnect && opts.autoReconnectInterval == null )
		opts.autoReconnectInterval = 1000;
	if ( self.opts.queueMessages == null )
		self.opts.queueMessages = true;

	// Properties
	self.name = name;
	self._servers = [];
	self._clientServers = [];
	self._clientServerByName = {};
	self._serverClients = [];
	self._serverClientByName = {};
	self._membersIKnow = {};
	self._membersOthersCountOnMe = {};
	self._msgQueueFor = {};

	// Methods
	self.connect = connect;
	self.disconnect = disconnect;
	self.addClient = addClient;
	self._newCServer = _newCServer;
	self.createServer = createServer;
	self.addServer = addServer;
	self._newSClient = _newSClient;

	self._handleMemberIO = _handleMemberIO;
	self._identifyMember = _identifyMember;
	self._destroyMember = _destroyMember;
	self._registerMembers = _registerMembers;
	self._registerMember = _registerMember;
	self._unregisterMembers = _unregisterMembers;
	self._unregisterMember = _unregisterMember;
	self.everybody = everybody;
	self._tellThatIamConnectionFor = _tellThatIamConnectionFor;
	self._tellThatIamNotConnectionFor = _tellThatIamNotConnectionFor;
	self.sendMessage = sendMessage;
	self._sendMessage = _sendMessage;
	self._checkMessagesFor = _checkMessagesFor;
	self._queueMessage = _queueMessage;
	self._receiveMessage = _receiveMessage;
	self.directMember = directMember;
	self._send = _send;
	self.__send = __send;
	self._debug = _debug;

	// Timeouts
	if ( opts.timeoutWatchInterval && opts.pingAfter ) {
		setInterval(function(){
			var now = new Date().getTime();
			self.everybody().forEach(function(somebody){
				if ( !somebody.dropped && somebody.lastContact < now-opts.pingAfter ) {
					self.__send(somebody,{c:"ping"});
					somebody.pingTimeout = setTimeout(function(){
						self._debug(7,"Ping timeout on "+(somebody.name || somebody.id)+", disconnecting...");
						somebody.disconnect();
					},opts.pingTimeout*Math.random());
				}
			});
		},opts.timeoutWatchInterval);
	}

};
util.inherits(SecretAgent, events.EventEmitter);


/*
  Client stuff
 */

// Connect to a server and add the client socket connection
function connect(server,callback) {

	var
		self = this,
		servers = (server instanceof Array) ? server : [server],
		clients = [],
		client;

	servers.forEach(function(server){
		var
			host = server.host || "127.0.0.1",
			port = server.port || 8124,
			connecting = true;

		self._debug(7,"Connecting to "+host+":"+port);

		// Connect
		client = net.connect(port,host,function(){
			self._debug(7,"Connected to "+host+":"+port);
			connecting = false;
		})
		.on('error',function(err){
			if ( connecting ) {
				self._debug(7,"Error connecting to "+host+":"+port+"...: ",err.toString());
				if ( err.code == "ECONNREFUSED" && self.opts.autoReconnect ) {
					// Try connecting later
					process.nextTick(function(){
						setTimeout(function(){
							return self.connect(server,callback);
						},self.opts.autoReconnectInterval);
					});
				}
			}
			else {
				self._debug(8,"Error on connection with "+host+":"+port+": ",err);zzz
			}
		});
		self.addClient(client)
		clients.push(client);
	});

	return clients;

}

// Disconnect
function disconnect(serverNameOrNumber) {

	var
		self = this;

	if ( typeof(serverNameOrNumber) == "number" )
		return self._clientServers[serverNameOrNumber].disconnect();

	self._clientServerByName[serverNameOrNumber].disconnect();

}

// Add a client, using his socket connection
function addClient(con) {

	var
		self = this,
		iknow = Object.keys(self._membersIKnow),
		srv = self._newCServer(con);

	self._clientServers.push(srv);

	// Identify myself
	self.__send(srv,{c:"hi!","mynameis":self.name,iknow:iknow});
	iknow.forEach(function(name){ srv.toldHimAbout[name] = true; });

	return srv;

}

// Create a new client object, based on a socket connection
function _newCServer(con) {

	var
		self = this,
		srv = {
			type: "server",
			host: con.remoteAddress,
			port: con.remotePort,
			mstream: new MessageStream("JSON",con),
			connected: new Date(),
			name: null,
			id: "#CS"+new Date().getTime()+"."+Math.random(),
			toldHimAbout: { },
			lastContact: null,
			pingTimeout: null,
			dropped: false,
			connect: function(callback){
				return self.connect({port: srv.port, host: srv.host},callback);
			},
			disconnect: function(){
				self._destroyMember(srv);
				srv.dropped = true;
				return srv.mstream.end();
			}
		};

	return self._handleMemberIO(srv);
}


/*
  Server stuff
 */

// Create a socket server
function createServer(port,callback) {

	var
		self = this,
		server = net.createServer();

	// Arguments
	if ( typeof port == "function" ) {
		callback = port;
		port = 8124;
	}

	// Listen
	server.listen(port,function(){
		self._debug(7,"Listening on port "+port+"...");
		if ( callback )
			return callback();
	});
	return self.addServer(server);

}

// Add a socket server
function addServer(server) {

	var
		self = this;

	// Add server to our list
	self._servers.push(server);

	// Wait for connections
	server.on('connection',function(c){
		self._serverClients.push(self._newSClient(c));
	});

}

// Create new server client
function _newSClient(con) {

	var
		self = this,
		cli = {
			type: "client",
			mstream: new MessageStream("JSON",con),
			connected: new Date(),
			name: null,
			id: "#SC"+new Date().getTime()+"."+Math.random(),
			toldHimAbout: {},
			lastContact: new Date(),
			pingTimeout: null,
			dropped: false,
			disconnect: function(){
				self._destroyMember(cli);
				cli.dropped = true;
				return this.mstream.end();
			}
		};

	return self._handleMemberIO(cli);

};


/*
  Common stuff
 */

// Handle members IO
function _handleMemberIO(member) {

	var
		self = this;

	// Received a message
	member.mstream.on('message',function(m){
		self._debug(9,"["+member.id+"] Got a llmsg from "+(member.name || member.id)+": ",m);
		member.lastContact = new Date().getTime();
		if ( m.c == "ping" ) {
			return self.__send(member,{a:"ping"});
		}
		else if ( m.a == "ping" ) {
			if ( !member.pingTimeout )
				return;
			clearTimeout(member.pingTimeout);
			member.pingTimeout = null;
			return;
		}
		else if ( member.type == "client" && m.c == "hi!" ) {
			if ( m.mynameis != null ) {
				var iknow = Object.keys(self._membersIKnow);
				iknow.forEach(function(name){ member.toldHimAbout[name] = true; });
				self._identifyMember(member,m.mynameis,m.iknow);
				return self.__send(member,{a:"hi!",mynameis:self.name,iknow:iknow});
			}
		}
		else if ( member.type == "server" && m.a == "hi!" ) {
			if ( m.mynameis != null ) {
				if ( self.directMember(m.mynameis) ) {
					self._debug(7,"I am already connected with '"+m.mynameis+"', dropping connection..");
					return member.disconnect();
				}
				return self._identifyMember(member,m.mynameis,m.iknow);
			}
		}
		else if ( m.c == "imcon4" ) {
			if ( m.who && m.who instanceof Array ) {
				self._debug(4,"Registering connection "+m.who.join(',')+" via "+member.name);
				var met = self._registerMembers(m.who,member.name);
				if ( met.length > 0 ) {
					self._debug(5,"JUST MET: ",met);
					self._debug(5,"Now i knoW: ",Object.keys(self._membersIKnow));
					met.forEach(function(memberIJustMet){
						self.emit('meet',memberIJustMet);
					});
					self._checkMessagesFor(met);
				}
				return self._tellThatIamConnectionFor(m.who,[member.name]);
			}
		}
		else if ( m.c == "im!con4" ) {
			if ( m.who && m.who instanceof Array ) {
				self._debug(4,"Removing connection "+m.who.join(',')+" via "+member.name);
				var lostOrAlmost = self._unregisterMembers(m.who,member.name);
				if ( lostOrAlmost.lost.length > 0 ) {
					self._debug(6,"JUST LOST: ",lostOrAlmost.lost);
					lostOrAlmost.lost.forEach(function(memberIJustLost){
						self.emit('loose',memberIJustLost);
					});
				}
				if ( lostOrAlmost.almost.length > 0 ) {
					self._debug(6,"Almost lost: ",lostOrAlmost.almost);
				}
				self._debug(6,"Now i knoW: ",Object.keys(self._membersIKnow));
				return self._tellThatIamNotConnectionFor(m.who,[member.name]);
			}
		}
		else if ( m.c == "msg" ) {
			if ( m.f && m.t && m.m )
				return self._receiveMessage(m.f,m.t,m.m,member.name);
		}
		self._debug(9,"["+member.id+"] Misunderstood message: ",m);
	});
	// Error
	member.mstream.on('error',function(err){
		self._debug(7,"["+member.id+"] Got an error from "+(member.name || member.id)+": ",err);
	});
	// Disconnected
	member.mstream.on('end',function(){
		self._debug(7,"["+member.id+"] "+member.type.toUpperCase()+" "+(member.name || member.id)+" ("+member.type+") disconnected");
		if ( member.type == "server" && !member.dropped && self.opts.autoReconnect ) {
			process.nextTick(function(){
				self._debug(7,"Reconnecting with member "+(member.name || member.id)+" ("+member.host+":"+member.port+") ...");
				self.connect(member.port,member.host);
			});
		}
		return self._destroyMember(member);
	});

	return member;

}

// Identify a direct member client/server
function _identifyMember(member,name,membersHeKnows) {

	var
		self = this,
		haveConWith = [],
		met = [];

	// Register server
	member.name = name;
	self._clientServerByName[name] = member;
	self._registerMember(name,null);
	self.emit('meet',name);

	// Register members he know (if he knows, now i know i can speak with them through him)
	if ( membersHeKnows && membersHeKnows instanceof Array ) {
		member.membersHeKnows = [];
		met = self._registerMembers(membersHeKnows,member.name);
		haveConWith = membersHeKnows;
	}
	haveConWith.push(name);

	// Tell everybody who i just met (i'm so excited!)
	self._tellThatIamConnectionFor(haveConWith,[member.name]);
	if ( met.length > 0 ) {
		self._debug(5,"JUST MET: ",met);
		self._debug(5,"Now I know: ",Object.keys(self._membersIKnow));
		met.forEach(function(memberIJustMet){
			self.emit('meet',memberIJustMet);
		});
	}

	// Check messages for our recently identified member and for member he knows.
	self._checkMessagesFor([name].concat(met));

	return member;

}

// Destroy a direct member
function _destroyMember(member) {

	var
		self = this,
		lostOrAlmost,
		lost = [],
		almost = [],
		memberList = (member.type == "server") ? self._clientServers : self._serverClients;

	// Already destroied?
	if ( member.dropped )
		return;

	self._debug(8,"Destroying "+(member.name || member.id));

	// Delete from client/servers list
	for ( var x = 0 ; x < memberList.length ; x++ ) {
		if ( memberList[x].id == member.id ) {
			memberList.splice(x,1);
			break;
		}
	}

	// If he was identified
	if ( member.name ) {
		// Delete from identified server list
		delete self._clientServerByName[member.name];

		// Unregister him
		lostOrAlmost = self._unregisterMembers([member.name],null);
		lost = lost.concat(lostOrAlmost.lost);
		almost = almost.concat(lostOrAlmost.almost);

		// Unregister member that i knew through him
		lostOrAlmost = self._unregisterMembers(member.membersHeKnows,member.name);
		lost = lost.concat(lostOrAlmost.lost);
		almost = almost.concat(lostOrAlmost.almost);

		// If I lost somebody
		if ( lost.length > 0 ) {
			self._debug(6,"JUST LOST: ",lost);
			self._debug(6,"He knew: ",member.membersHeKnows);
			lost.forEach(function(memberIJustLost){
				self.emit('loose',memberIJustLost);
			});
			self._tellThatIamNotConnectionFor(lost,[member.name]);
		}
		// If I am almost loosing somebody (just have one connection), tell that connection that i'm counting on him to ensure the connection
		if ( almost.length > 0 ) {
			self._debug(6,"ALMOST LOOSING: ",almost);
			self._tellThatIamNotConnectionFor(almost,[member.name]);
		}
	}

	if ( Object.keys(self._membersIKnow).length > 0 )
		self._debug(6,"I still know: ",Object.keys(self._membersIKnow));
	else
		self._debug(6,"I'm alone :'-(")

	return member;

}

// Register connections to members via other member (via can be null, for direct connections)
function _registerMembers(names,via) {

	var
		self = this,
		metNow = [];

	names.forEach(function(name){
		if ( self._registerMember(name,via) )
			metNow.push(name);
	});

	return metNow;

}

// Register a connection to a member via other member (via can be null, for a direct connection)
function _registerMember(name,via) {

	var
		self = this,
		viaMember,
		isNew = false;

	name = name.toString(); // we never know..

	// meeting myself._?
	if ( name == self.name )
		return false;

	// Add to list of people he knows
	if ( via ) {
		viaMember = self.directMember(via);
		if ( viaMember.membersHeKnows.indexOf(name) == -1 )
			viaMember.membersHeKnows.push(name);
	}

	// I didn't know this guy?
	if ( self._membersIKnow[name] == null ) {
		self._membersIKnow[name] = [];
		isNew = true;
	}
	// Make sure it's not already there
	for ( var x = 0 ; x < self._membersIKnow[name] ; x++ ) {
		if ( self._membersIKnow[name][x].via == via )
			return false;
	}
	self._membersIKnow[name].push({via: via});

	return isNew;

}

// Unregister a member connection via other member (via can be null, for direct connections)
function _unregisterMembers(names,via) {

	var
		self = this,
		ret = {lost:[],almost:[]},
		numConnections;

	names.forEach(function(name){
		if ( name == self.name )
			return;
		numConnections = self._unregisterMember(name,via);
		self._debug(8,"Num connections with "+name+" is: ",numConnections);
		if ( numConnections == 0 )
			ret.lost.push(name);
		else if ( numConnections == 1 )
			ret.almost.push(name);
	});
	return ret;

}

// Unregister a connection to a member via other member (via can be null, for a direct connection)
function _unregisterMember(name,via) {

	var
		self = this,
		whoKnowsMember = self._membersIKnow[name] || [];

	for ( var x = 0 ; x < whoKnowsMember.length ; x++ ) {
		if ( whoKnowsMember[x].via == via ) {
			whoKnowsMember.splice(x,1);
			if ( whoKnowsMember.length == 0 ) {
				delete self._membersIKnow[name];
				return 0;
			}
			return whoKnowsMember.length;
		}
	}

	return whoKnowsMember.length;

}

// All my direct members
function everybody() {

	var
		self = this;

	return self._serverClients.concat(self._clientServers);
}

// Tell to others that I am now a connection for memberNames. Don't tell nothing to dontTellTo
function _tellThatIamConnectionFor(memberNames,dontTellTo) {

	var
		self = this,
		dontTellHash = {};

	// Hash the values of dontTell
	(dontTellTo || []).forEach(function(who){
		dontTellHash[who] = true;
	});

	// Tell to everybody, excluding those listed on dontTellTo
	return self.everybody().forEach(function(somebody){
		var who = [];
		if ( dontTellHash[somebody.name] )
			return;

		// Dont tell to the own member
		for ( var x = 0 ; x < memberNames.length ; x++ ) {
			if ( somebody.name != memberNames[x] && self.name != memberNames[x] ) {
				if ( !somebody.toldHimAbout[memberNames[x]] ) {
					self._debug(5,"Telling "+(somebody.name||somebody.id)+" that now I am a connection for "+memberNames[x]);
					somebody.toldHimAbout[memberNames[x]] = true;
					who.push(memberNames[x]);
				}
			}
		}
		if ( who.length > 0 )
			self.__send(somebody,{c:"imcon4",who:who});
	});

}

// Tell to others that I am not anymore a connection for memberNames. Don't tell nothing to dontTellTo
function _tellThatIamNotConnectionFor(memberNames,dontTellTo) {

	var
		self = this,
		dontTellHash = { },
		tellTo = {};

	// Hash the values of dontTell
	(dontTellTo || []).forEach(function(who){
		dontTellHash[who] = true;
	});

	self._debug(5,"Telling (not telling to "+dontTellTo.join(',')+") that I am not anymore connection for ",memberNames);

	// Tell
	self.everybody().forEach(function(somebody){
		var who = [];
		if ( dontTellHash[somebody.name] )
			return;

		// Dont tell to the own member
		for ( var x = 0 ; x < memberNames.length ; x++ ) {
			if ( somebody.name != memberNames[x] && self.name != memberNames[x] ) {
				if ( somebody.toldHimAbout[memberNames[x]] ) {
					self._debug(5,"Telling "+(somebody.name||somebody.id)+" that now I am not anymore connection for "+memberNames[x]);
					delete somebody.toldHimAbout[memberNames[x]];
					who.push(memberNames[x]);
				}
			}
		}
		if ( who.length > 0 )
			self.__send(somebody,{c:"im!con4",who:who});
	});

	// Tell
	return Object.keys(tellTo,function(who){
		self._debug(9,"!!!LOST!!!",tellTo[who]);
		self._send(who,{c:"lost",who:tellTo[who]});
	});

}

// Send a message
function sendMessage(to,message) {

	var
		self = this;

	if ( to == self.name )
		return self._receiveMessage(to,to,message);

	return self._sendMessage(self.name,to,message);

}

// Flow a message
function _sendMessage(from,to,message) {

	var
		self = this,
		via;

	// Do we know the recipient on the message ?
	if ( !self._membersIKnow[to] ) {
		if ( self.opts.queueMessages ) {
			self._debug(4,"I have a message for '"+to+"' that i don't know.. queuing it.");
			return self._queueMessage(from,to,message);
		}
		else {
			self._debug(4,"I have a message for '"+to+"' but he is not online. Discarding..");
			return null;
		}
	}

	// Direct connection ? Just send the message!
	if ( self.directMember(to) )
		return self._send(to,{c:"msg",f:from,t:to,m:message});

	// Send via somebody
	via = self._membersIKnow[to][0].via;
	if ( self.directMember(via) )
		return self._send(via,{c:"msg",f:from,t:to,m:message});

	self._debug(8,"Error calculating the target of the message for '"+to+"'. Queuing message.. BUG! Fix it please..");
	return self._queueMessage(from,to,message);

}

// Check messages for specific member(s)
function _checkMessagesFor(memberNames) {

	var
		self = this,
		members = (memberNames instanceof Array) ? memberNames : [memberNames];

	return members.forEach(function(name){
		if ( self._msgQueueFor[name] ) {
			while ( self._msgQueueFor[name].length > 0 ) {
				var msg = self._msgQueueFor[name].shift();
				self._sendMessage(msg.from,msg.to,msg.msg);
			}
		}
	});

}

// Queue a message
function _queueMessage(from,to,message) {

	var
		self = this;

	if ( self._msgQueueFor[to] == null )
		self._msgQueueFor[to] = [];
	self._msgQueueFor[to].push({from: from, to: to, msg: message});

	return false;

}

// Receive a message and flow it, or emit it
function _receiveMessage(from,to,message,directFrom) {

	var
		self = this;

	if ( to == self.name ) {
		self._debug(4,"Got a message for me (from "+from+", direct from: "+directFrom+"): ",message);
		self.emit('message',message,from,to,directFrom);
		return;
	}

	return self._sendMessage(from,to,message);

}

// Get the direct member with a specific name
function directMember(name) {

	var
		self = this;

	return self._serverClientByName[name] || self._clientServerByName[name];

}

// Send message to one or more users (by name)
function _send(who,message) {

	var
		self = this,
		names = (who instanceof Array) ? who : [who],
		somebody,
		sentTo = 0;

	names.forEach(function(name){
		somebody = self.directMember(who);
		if ( somebody ) {
			self.__send(somebody,message);
			sentTo++;
		}
	});

	return sentTo;

}

// Send a message to a user (the user object)
function __send(who,message) {

	var
		self = this;

	self._debug(9,"Sending llmsg to "+(who.name||who.id)+": ",message);
	return who.mstream.sendMessage(message);

}

// Debug
function _debug() {

	var
		self = this;

	if ( !self.opts.DEBUG )
		return;

	var
		args = Array.prototype.slice.call(arguments, 0),
		level = (args.length > 0 && typeof(args[0]) == "number") ? args.shift() : 9;

	if ( level > self.opts.DEBUG )
		return;
	args.unshift("["+self.name+"] ");

	return console.log.apply(null,args);

}

// Close an object - that way with a hammer
function _clone(obj) {
	if(obj == null || typeof(obj) != 'object')
		return obj;
	var temp = obj.constructor();
	for(var key in obj) {
		try { temp[key] = self._clone(obj[key]); }
		catch(ex){}
	}
	return temp;
}

/*
 Public stuff
 */

module.exports = SecretAgent;