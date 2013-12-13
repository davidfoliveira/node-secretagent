	var
		SecretAgent = require('./lib/secretagent'),
		markuswolf,
		aldrichames,
		juliusrosenberg;

	// Create the agents
	markuswolf = new SecretAgent("Wolf",{DEBUG:0});
	aldrichames = new SecretAgent("Ames",{DEBUG:0});
	juliusrosenberg = new SecretAgent("Rosenberg",{DEBUG:0});
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
