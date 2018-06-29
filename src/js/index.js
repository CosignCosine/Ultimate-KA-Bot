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

// String prototype extensions (Stolen from https://codereview.stackexchange.com/questions/133586/a-string-prototype-diff-implementation-text-diff)
Array.prototype.rotate = function(n){
	var len = this.length,
	    res = new Array(this.length);
	if (n % len === 0) return this.slice();
	else for (var i = 0; i < len; i++) res[i] = this[(i + (len + n % len)) % len];
	return res;
};

String.prototype.diff = function(s,p){       // p -> precision factor

  function getMatchingSubstring(s,l,m){      // returns the first matching substring in-between the two strings
    var i = 0,
     slen = s.length,
    match = false,
        o = {fis:slen, mtc:m, sbs:""};       // temporary object used to construct the cd (change data) object
    while (i < slen ) {
      l[i] === s[i] ? match ? o.sbs += s[i]  // o.sbs holds the matching substring itsef
    	                    : (match = true, o.fis = i, o.sbs = s[i])
    	            : match && (i = slen);   // stop after the first found substring
      ++i;
    }
    return o;
  }

  function getChanges(t,s,m){
    var isThisLonger = t.length >= s.length ? true : false,
    [longer,shorter] = isThisLonger ? [t,s] : [s,t], // assignment of longer and shorter by es6 destructuring
                  bi = 0;  // base index designating the index of first mismacthing character in both strings

    while (shorter[bi] === longer[bi] && bi < shorter.length) ++bi; // make bi the index of first mismatching character
    longer = longer.split("").slice(bi);   // as the longer string will be rotated it is converted into array
    shorter = shorter.slice(bi);           // shorter and longer now starts from the first mismatching character

    var  len = longer.length,              // length of the longer string
          cd = {fis: shorter.length,       // the index of matching string in the shorter string
                fil: len,                  // the index of matching string in the longer string
                sbs: "",                   // the matching substring itself
                mtc: m + s.slice(0,bi)},   // if exists mtc holds the matching string at the front
         sub = {sbs:""};                   // returned substring per 1 character rotation of the longer string

    if (shorter !== "") {
      for (var rc = 0; rc < len && sub.sbs.length < p; rc++){           // rc -> rotate count, p -> precision factor
        sub = getMatchingSubstring(shorter, longer.rotate(rc), cd.mtc); // rotate longer string 1 char and get substring
        sub.fil = rc < len - sub.fis ? sub.fis + rc                     // mismatch is longer than the mismatch in short
                                     : sub.fis - len + rc;              // mismatch is shorter than the mismatch in short
        sub.sbs.length > cd.sbs.length && (cd = sub);                   // only keep the one with the longest substring.
      }
    }
    // insert the mismatching delete subsrt and insert substr to the cd object and attach the previous substring
    [cd.del, cd.ins] = isThisLonger ? [longer.slice(0,cd.fil).join(""), shorter.slice(0,cd.fis)]
                                    : [shorter.slice(0,cd.fis), longer.slice(0,cd.fil).join("")];
    return cd.del.indexOf(" ") == -1 ||
           cd.ins.indexOf(" ") == -1 ||
           cd.del === ""             ||
           cd.ins === ""             ||
           cd.sbs === ""              ? cd : getChanges(cd.del, cd.ins, cd.mtc);
  }

  var changeData = getChanges(this,s,""),
           nextS = s.slice(changeData.mtc.length + changeData.ins.length + changeData.sbs.length),    // remaining part of "s"
        nextThis = this.slice(changeData.mtc.length + changeData.del.length + changeData.sbs.length), // remaining part of "this"
          result = "";  // the glorious result
  changeData.del.length > 0 && (changeData.del = '<span class = "deleted">'  + changeData.del + '</span>');
  changeData.ins.length > 0 && (changeData.ins = '<span class = "inserted">' + changeData.ins + '</span>');
  result = changeData.mtc + changeData.del + changeData.ins + changeData.sbs;
  result += (nextThis !== "" || nextS !== "") ? nextThis.diff(nextS,p) : "";
  return result;
};

// Requirements and instantiation
const Discord = require('discord.js'),
      fs = require('fs'),
      request = require('request'),
      express = require('express'),
      webClient = express(),
      OAuth1Client = require("oauth-1-client");

// Load version
var version = '0.0';
fs.readFile(__dirname + '/../../package.json', 'utf-8', (err, response) => {
  var data = JSON.parse(response);
  version = data.version;
})
var discordClient = new Discord.Client();

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
    confirmation = message => {
      var acceptEmbed = new Discord.RichEmbed();
      acceptEmbed.setTitle('Information');
      acceptEmbed.setDescription('Data has been sent to your DMs.');
      acceptEmbed.setFooter('Please make sure to have direct messages for this server enabled, or you will not get the data.')
      acceptEmbed.setColor(COLORS.INFORMATION);
      message.channel.send({embed: acceptEmbed});
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
        console.log(userID);
        var associatedDiff = {};
        for(var [key, value] of discordClient.users){
          associatedDiff[key] = value.username.diff(userID)
          console.log(associatedDiff[key])
        }
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
webClient.listen(PORT, function () {
  console.log('[UKB] Web client open on port ' + PORT + '!')
})

// Discord
discordClient.on('ready', () => {
  console.log('[UKB] Discord client open!');
  discordClient.user.setPresence({ game: { name: 'Version ' + version + " | " + PREFIX + "help" }, status: 'idle' })
});
discordClient.on('message', (message) => {
  if(message.content.startsWith(PREFIX)){
    var command = message.content.replace(PREFIX, '').split(' ')[0];
    var arg = message.content.substr(command.length + PREFIX.length + 1, message.content.length-1)
    if(commands[command]){
      commands[command].run(message, arg);
    }else{
      message.channel.send('no')
    }
  }
});

// Process handlers
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
