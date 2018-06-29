// @TODO major code refactor, move all variable types to each other (const => const, var => var)
// @TODO code sections, variable renaming
// @TODO response functions (user sends message on discord, bot responds and waits for user input, etc.) [make recursive?]
// @TODO emojis for prompts (redo leaf emoji?)
// @TODO heroku pgsql database?

const DEBUG = false,
      PREFIX = 'ka!',
      COLORS = {
        INFORMATION: '#8fb6d4',
        COMPLETE: '#BADA55',
        ERROR: '#FF0000'
      },
      RELOAD_CHANNEL = '460219376654876673',
      PING_USER = '198942810571931649', // Scott
      CALLBACK_URL = ['http://ukb.herokuapp.com/', 'http://0.0.0.0/'][DEBUG&1],
      KA = 'www.khanacademy.org',
      PORT = process.env.PORT || 8080;
/**
@TODO Commands left to implement:
- ka&getNotifs
- ka&login/ka&link
- ka&me/ka&profile
- ka&unlink/ka&logout
- ka&whois/ka&who (e.g. u&ka&whois @Scott#4276 on ka [returns @ct20024], u&ka&whois ct200224 on discord [returns @Scott#4276])
- ka&graph

Administrative Commands
- admin&setLoginChannel
- admin&checkIfBanned (admin because this is sensitive information)
*/

/**
Ideas:
Send user a message on KA when they are banned from a server with the bot if they no longer share a server with it?
*/

// Requirements and instantiation
const Discord = require('discord.js'),
      fs = require('fs'),
      request = require('request'),
      express = require('express'),
      webClient = express(),
      OAuth1Client = require("oauth-1-client"),
      levenshtein = require('js-levenshtein');

// Load version
var version = '0.0';
fs.readFile(__dirname + '/../../package.json', 'utf-8', (err, response) => {
  var data = JSON.parse(response);
  version = data.version;
})
var discordClient = new Discord.Client();
var commandsRun = 0;

// Discord Token loading
discordClient.login(process.env.TOKEN)

// KA Consumer Token loading
var keys = {key: process.env.KEY, secret: process.env.SECRET}, queries = {}, users = {};
const client = new OAuth1Client({
    key: keys.key,
    secret: keys.secret,
    callbackURL: CALLBACK_URL,
    requestUrl: `https://${KA}/api/auth2/request_token?oauth_callback=${CALLBACK_URL}`,
    accessUrl: `https://${KA}/api/auth2/access_token`,
    apiHostName: KA
});

// Utility functions
var hToObj = body => body.split('&').reduce((a, c, i) => { var b = c.split('='); a[b[0]] = b[1]; return a;}, {}),
    confirmation = (message, channel) => {
      if(!channel) channel = message.channel.id;
      var acceptEmbed = new Discord.RichEmbed();
      acceptEmbed.setTitle('Information');
      acceptEmbed.setDescription('Data has been sent to your DMs.');
      acceptEmbed.setFooter('Please make sure to have direct messages for this server enabled, or you will not get the data.')
      acceptEmbed.setColor(COLORS.INFORMATION);
      discordClient.channels.get(channel).send({embed: acceptEmbed});
    },
    dError = (message, messageContent) => {
      var ee = new Discord.RichEmbed();
      ee.setTitle('Error!')
      ee.setDescription(messageContent);
      ee.setColor(COLORS.ERROR);
      message.channel.send({embed: ee});
    },
    handleShutdown = () => {
      discordClient.channels.get(RELOAD_CHANNEL).send('Bot shutting down. If this is an error please inspect. Pinging: ' + discordClient.users.get(PING_USER).toString())
        .then(m=>{
          discordClient.destroy()
            .then(a=>{
              console.log('destroyed discord client')
              process.exit()
            });
        })
    };

// Commands
var commands = {
  login: {
    run(message, arg){
      var acceptEmbed = new Discord.RichEmbed();
      acceptEmbed.setTitle('KA Login');
      acceptEmbed.setDescription('Instructions have been sent to your direct messages.');
      acceptEmbed.setFooter('Please make sure to have direct messages for this server enabled, or you will not get the login URL.')
      acceptEmbed.setColor(COLORS.INFORMATION);
      message.channel.send({embed: acceptEmbed})
      client.requestToken()
        .then(response => {
          users[message.author.id] = {request_token: response.token, request_secret: response.tokenSecret};
          var loginEmbed = new Discord.RichEmbed();
          loginEmbed.setDescription('[Connect KA Account](https://www.khanacademy.org/api/auth2/authorize?oauth_token=' + response.token + ')')
          loginEmbed.setTitle('Click the link below to connect your KA and Discord accounts.')
          loginEmbed.setColor(COLORS.COMPLETE)
          message.author.send({embed: loginEmbed})
            .catch(e => {
              dError(message, 'I couldn\'t send a message to your DM! Can you please enable DMs for this server so that I can log you in?');
            })
        })
    },
    documentation: 'This commands allows the user to login to their KA account.'
  },
  banned: {
    run(message, arg){
      if(!users[message.author.id]){
        dError(message, 'It looks like you haven\'t yet set up a profile with `u&ka&login`. Please run that command before trying to get private statistics about your account!');
      }else{
        confirmation(message);
        var ee = new Discord.RichEmbed();
        ee.setTitle('Discussion Ban')
        ee.setDescription(`You have ${users[message.author.id].discussionBanned ? '' : 'not '}been discussion banned.`);
        ee.setColor(COLORS.COMPLETE);
        message.author.send({embed: ee})
          .catch(e => {
            dError(message, 'I couldn\'t send a message to your DM! Can you please enable DMs for this server so that I can log you in?');
          })
      }
    },
    documentation: 'This commands allows the user to check if their KA account is discussion banned. `Note: This information is private and will be sent to DMs only. If you choose to make it public that is up to you.`'
  },
  whois: {
    run(message, arg){
      var userID = arg.replace(/\!|\@|<|>/gim, '');
      if(isNaN(+userID)){
        var associatedDiff = [];
        for(var [key, value] of discordClient.users){
          associatedDiff.push(key, levenshtein(userID, value.username));
          console.log(value)
          associatedDiff.push(key, levenshtein(userID, message.guild.members.get(value.id).nickname))
        }
        associatedDiff = associatedDiff.sort();
        console.log(associatedDiff)
      }
      message.channel.send(arg)
    }
  }
}
commands.help = {
  run(message, arg){
    var ee = new Discord.RichEmbed();
    ee.setTitle('Commands Help')
    ee.setDescription(`The current commands are: ${PREFIX}**${Object.keys(commands).join('**, ' + PREFIX + '**')}**`);
    ee.setFooter(`Run ${PREFIX}help [command] to find out more information about each specific command.`)
    ee.setColor(COLORS.COMPLETE);
    message.channel.send({embed: ee})
  }
}

// Web
webClient.engine('html', require('ejs').renderFile);
webClient.set('views', '.');
webClient.get('/', function (req, res) {
  res.render('src/html/index.html')
  const { query } = req;
  console.log('[UKB] Webserver connection acquired.')
  if(query){
    var id;
    for(var i in users){
      if(users[i].request_token === query.oauth_token){
        id = i;
        users[i].oauth_verifier = query.oauth_verifier;
      }
    }
    if(!id){
      console.log('[UKB] Illegal/Malformed Request to webserver');
      return;
    }
    client.accessToken(query.oauth_token, query.oauth_token_secret, query.oauth_verifier)
      .then(tokens => {
        var { token, tokenSecret } = tokens;
        users[id].request_token_secret = tokenSecret;
        client.auth(token, tokenSecret)
          .get("/api/v1/user", { casing: "camel" })
          .then(response => {
            if(typeof response.body !== 'object') response.body = JSON.parse(response.body);
            var rem = new Discord.RichEmbed();
            rem.setDescription(['Heya', 'Hello', 'Hi', 'Sup', 'Welcome'][Math.floor(Math.random()*5)] + ', **' + response.body.studentSummary.nickname + '**!')
            rem.setFooter('You\'re all set up!');
            rem.setColor('#BADA55');
            discordClient.users.get(id).send({embed: rem})
            users[i].info = response.body;
            users[i].lastUpdate = new Date();
          })
      })
  }
});
webClient.listen(PORT, function () {
  console.log('[UKB] Web client open on port ' + PORT + '!')
})

// Discord
discordClient.on('ready', () => {
  console.log('[UKB] Discord client open!');
  discordClient.user.setPresence({ game: { name: 'Version ' + version + " | " + PREFIX + "help" }, status: 'idle' })
  setInterval(function(){
    var acceptEmbed = new Discord.RichEmbed();
    acceptEmbed.setTitle('Statistics');
    acceptEmbed.setDescription('Number of commands run this cycle: **' + commandsRun + '**');
    acceptEmbed.setFooter('This data reloads every 20 minutes.')
    acceptEmbed.setColor(COLORS.INFORMATION);
    discordClient.channels.get(RELOAD_CHANNEL).send({embed: acceptEmbed});
    commadsRun = 0;
  }, 1200000)
});
discordClient.on('message', (message) => {
  if(message.content.startsWith(PREFIX)){
    var command = message.content.replace(PREFIX, '').split(' ')[0];
    var arg = message.content.substr(command.length + PREFIX.length + 1, message.content.length-1)
    if(commands[command]){
      commandsRun++;
      commands[command].run(message, arg);
    }else{
      message.channel.send('no')
    }
  }
});

// Process handlers
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
