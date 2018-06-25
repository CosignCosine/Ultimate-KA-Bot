const DEBUG = 0;
const CONFIG = {
  SERVER_DATA_CHANNEL: 460853247977062401,
  USER_DATA_CHANNEL: 460853259448352778
};
/**
Commands left to implement:
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
const Discord = require('discord.js');
const fs = require('fs');
const request = require('request');
const express = require('express');
const webClient = express();
const OAuth1Client = require("oauth-1-client");
var discordClient = new Discord.Client();



var port = process.env.PORT || 8080;

// Discord Token loading
discordClient.login(process.env.TOKEN)

// KA Consumer Token loading
var keys = {key: process.env.KEY, secret: process.env.SECRET};
var queries = {};
var callbackURL = ['http://ukb.herokuapp.com/', 'http://0.0.0.0/'][DEBUG];
const KA = 'www.khanacademy.org'
var users = {};

const client = new OAuth1Client({
    key: keys.key,
    secret: keys.secret,
    callbackURL: callbackURL,
    requestUrl: `https://${KA}/api/auth2/request_token?oauth_callback=${callbackURL}`,
    accessUrl: `https://${KA}/api/auth2/access_token`,
    apiHostName: KA
});


var hToObj = body => body.split('&').reduce((a, c, i) => { var b = c.split('='); a[b[0]] = b[1]; return a;}, {});
var backupJSONToDiscord = () => {
  fs.writeFile('./users.json', JSON.stringify(users), function(err){
    if(!err) console.log('[UKB] File backed up successfully! Uploading to backup channel...');
  })
};

// Commands
var commands = {
  ka: {
    login: {
      run(message, args){
        var acceptEmbed = new Discord.RichEmbed();
        acceptEmbed.setTitle('KA Login');
        acceptEmbed.setDescription('Instructions have been sent to your direct messages.');
        acceptEmbed.setFooter('Please make sure to have direct messages for this server enabled, or you will not get the login URL.')
        acceptEmbed.setColor('#BADA55');
        message.channel.send({embed: acceptEmbed})
        client.requestToken()
          .then(response => {
            users[message.author.id] = {request_token: response.token, request_secret: response.tokenSecret};
            console.log(users[message.author.id]);
            var loginEmbed = new Discord.RichEmbed();
            loginEmbed.setDescription('[Connect KA Account](https://www.khanacademy.org/api/auth2/authorize?oauth_token=' + response.token + ')')
            loginEmbed.setTitle('Click the link below to connect your KA and Discord accounts.')
            loginEmbed.setColor('#BADA55')
            message.author.send({embed: loginEmbed})
          })
      }
    }
  },
  admin: {

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
    client.accessToken(
        query.oauth_token,
        query.oauth_token_secret,
        query.oauth_verifier
    ).then(tokens => {
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
webClient.listen(port, function () {
  console.log('[UKB] Web client open on port ' + port + '!')
})

// Discord
discordClient.on('ready', () => {
  console.log('[UKB] Discord client open!');
});

discordClient.on('message', (message) => {
  if(message.content.startsWith('u&')){
    var commandFolder = message.content.split('&')[1];
    if(!commands[commandFolder]){
      message.channel.send('placeholder for: not a valid command folder! try ' + Object.keys(commands).join(", "))
      return;
    }
    var command = message.content.split('&')[2];
    if(commands[commandFolder][command]){
      commands[commandFolder][command].run(message, message.content.split('&')[3])
    } else {
      message.channel.send('placeholder for: not a valid command! try ' + Object.keys(commands[commandFolder]).join(", "))
      return;
    }
  }
});
