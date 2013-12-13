# secretagent - A socket-based messaging system with *automatic failover*

`secretagent` is a JSON messaging system based on simple tcp/ip sockets where the *agents* try to find alternative ways for speaking with each other on the case of network fails.

# The *automatic failover*

Supposing that we have four agents (`France`, `America`, `Britain` and `CCCP` ☭) who will send messages to each other, we will determine that they will all establish connections to the other members of the conversation.
The connections will be `France->America`, `America->Britain`, `Britain->CCCP`, `France->Britain`, `France->CCCP` and `America->CCCP`.

When `France` wants to send a message to `America`, will use the connection that they have in common (`France->America`), when `Britain` wants to send a message to `America`, will use the connection that they have in common (`America->Britain`) and so on...

Everything works just fine until they experience some network problems. Let's suppose that exists a network problem cutting the connection `France->CCCP`. When `France` emits a message to `CCCP` will realize that this connection is down, so they need to search for an allied that still has connection with `CCCP` for delivering that message. On this case, the message will be sent to `America` that will deliver directly to `CCCP`. If the connection between `America` and `CCCP` goes down too, the connection is still possible on this way: `France->America->Britain->CCCP`.

# Installing

	npm install secretagent

# Using

	var
		SecretAgent = require('secretagent'),
		markuswolf,
		aldrichames,
		juliusrosenberg;

	// Create the agents
	markuswolf      = new SecretAgent("Wolf");
	aldrichames     = new SecretAgent("Ames");
	juliusrosenberg = new SecretAgent("Rosenberg");
	[markuswolf,aldrichames,juliusrosenberg].forEach(function(agent){
		agent.on('message',function(msg,from){
			console.log("["+agent.name+"] Got a message from "+from+": ",msg);
		});
	});

	// Listen for connections
	markuswolf.createServer(8124);
	aldrichames.createServer(8125);
	juliusrosenberg.createServer(8126);

	// Connect them all (the order here is not important)
	aldrichames.connect([{port: 8124}]);		// Connect Ames with Wolf
	juliusrosenberg.connect([{port: 8125}]);	// Connect Rosenberg with Ames
	markuswolf.connect([{port: 8126}]);		// Connect Wolf with Rosenberg

	// Send messages
	juliusrosenberg.sendMessage("Wolf",{subject: "Meeting", content: "KGB metting in Moscow - 1st February"});

	// Wait a little (so they can connect all to each other.. but, connect() has a callback which allows you to know if he is already connected)
	setTimeout(function(){

		// Disconnect something, just for testing..
		markuswolf.disconnect("Rosenberg");

		setTimeout(function(){
			// Send messages anyway
			markuswolf.sendMessage("Rosenberg",{subject: "Meeting", content: "Understood. I'll be there."});
		},1000);

	},1000);

Of course that the ideia is using this on multiple processes/machines/soviets.

# The API

## The `SecretAgent` class:

### Constructor: `new SecretAgent(agentName[,opts])`.

Supported options are:

- `autoReconnect`: Defines if the agent should try reconnecting when a connection goes down. Default: `true`;
- `autoReconnectInterval`: When `autoReconnect` is `true`, defines the interval time (in *ms*) for trying to reconnect. Default `1000`;
- `queueMessages`: Defines if the messages that are sent to an unreachable agent, should be kept in queue for being sent later, when we have contact with the agent. Default: `true`;
- `pingTimeout`: Sets the limit of time (in *ms*) for waiting for a `ping` answer. Default: `1500`;
- `pingAfter`: Sets the time (in *ms*) that we should wait until sending a `ping` request. Default: `5000`

### createServer(port[,callback])

Starts listening on specified `port` number.

### addServer(serverSocket)

Adds an previously created socket server.

### connect({host: "IP_OR_HOSTNAME", port: PORT_NUMBER}[,callback])

Connects to other agent on the specified `host` and `port`. Host and port parameters are not required. If they are missing, "127.0.0.1" and 8124 will be assumed as defaults.

### addClient(clientSocket)

Adds a previously connected client socket.

### disconnect(serverNameOrNumber)

Disconnects from a server with the specified name or `connect()` sequence number.

### sendMessage(destMemberName,messageObj)

Sends the specified message object to the supplied member name.

### directMember(memberName)

Returns the member object having the supplied direct (with direct connection) member name, or `null`, on the case that the member doesn't have a direct connection with the agent.

### everybody()

Returns an array with every direct member.


# TODO

- Message delivery confirmation;
- Retry message sending if they didn't get out of kernel's buffer;
- Choose the faster/shorter way (direct or with less elements on the middle).
