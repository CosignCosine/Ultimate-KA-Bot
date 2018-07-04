// @TODO major code refactor, move all variable types to each other (const => const, var => var)
// @TODO code sections, variable renaming
// @TODO response functions (user sends message on discord, bot responds and waits for user input, etc.) [make recursive?]
// @TODO emojis for prompts (redo leaf emoji?)
// @TODO heroku pgsql database?

const DEBUG = true,
      PREFIX = DEBUG ? 'B_ka!' : 'ka!',
      COLORS = {
        INFORMATION: '#95c0ff',
        COMPLETE: '#0066ff',
        ERROR: '#FF0000'
      },
      RELOAD_CHANNEL = '460219376654876673',
      PING_USER = '198942810571931649', // Scott
      CALLBACK_URL = ['http://ukb.herokuapp.com/', 'http://localhost/'][DEBUG&1],
      KA = 'www.khanacademy.org',
      PORT = process.env.PORT || 80;
/**
@TODO Commands left to implement:
- ka&getNotifs
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
      levenshtein = require('js-levenshtein'),
      { Client } = require('pg');

// Load version and debug tokens
var version = '0.0', interval;
fs.readFile(__dirname + '/../../package.json', 'utf-8', (err, response) => {
  var data = JSON.parse(response);
  version = data.version;
})
var discordClient = new Discord.Client();
var commandsRun = 0;
var { TOKEN, SECRET, KEY, DATABASE_URL } = process.env;
var markedForReLogin = [];
if(DEBUG){
  var dbTokens = JSON.parse(fs.readFileSync(__dirname + '/secret.json'));
  TOKEN = dbTokens.token;
  SECRET = dbTokens.secret;
  KEY = dbTokens.key;
  DATABASE_URL = dbTokens.databaseUrl
  DB = {
    USER: dbTokens.user,
    HOST: dbTokens.host,
    DB: dbTokens.db,
    PASSWORD: dbTokens.password,
    PORT: dbTokens.port
  }
}

// Discord Token loading
discordClient.login(TOKEN)

// KA Consumer Token loading
var keys = {key: KEY, secret: SECRET}, queries = {}, users = {};
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
            .then(()=>{
              console.log('[UKB] Destroyed Discord client, killed process with exit type 0.')
              clearInterval(interval);
              process.exit()
            }).catch(e => {
              console.log(e);
            })
        })
    },
    queryI = (id, callback) => {
      pgSQLClient.query('SELECT * FROM users WHERE ID = \'' + id + '\';', callback);
    }

// PostgreSQL client
const pgSQLClient = new Client(DEBUG ? {
  user: DB.USER,
  host: DB.HOST,
  database: DB.DB,
  password: DB.PASSWORD,
  port: DB.PORT,
  ssl: true
} : {connectionString: DATABASE_URL});
pgSQLClient.connect()
  .then(()=>{
    console.log('[UKB] PostgreSQLdb connection acquired.')
  })
  .catch((e)=>{
    console.log(e.stack)
  })

// Commands
var commands = {
  login: {
    run(message, arg){
      queryI(message.author.id, (err, res) => {
        if(err || res.rows.length !== 1 || markedForReLogin.includes(message.author.id)){
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
        }else{
          dError(message, 'User already exists!')
        }
      })
    },
    documentation: 'This commands allows the user to login to their KA account.'
  },
  link: this.login,
  banned: {
    run(message, arg){
      queryI(message.author.id, (err, res) => {
        if(err || res.rows.length !== 1){
          dError(message, 'It looks like you haven\'t yet set up a profile with `' + PREFIX + 'login`. Please run that command before trying to get private statistics about your account!');
          return;
        }
        client.auth(res.rows[0].token, res.rows[0].secret)
          .get("/api/v1/user", { casing: "camel" })
          .then(response => {
            confirmation(message);
            var ee = new Discord.RichEmbed();
            ee.setTitle('Discussion Ban')
            ee.setDescription(`You have ${response.body.discussionBanned ? '' : 'not '}been discussion banned.`);
            ee.setColor(COLORS.COMPLETE);
            message.author.send({embed: ee})
              .catch(e => {
                dError(message, 'I couldn\'t send a message to your DM! Can you please enable DMs for this server so that I can DM you?');
              })
        })
      })
    },
    documentation: 'This command allows the user to check if their KA account is discussion banned. `Note: This information is private and will be sent to DMs only. If you choose to make it public that is up to you.`'
  },
  whois: {
    run(message, arg){
      if(message.content.replace(/\W+/gim, '').match(/ondiscord/gim)){
        pgSQLClient.query('SELECT * FROM users WHERE username=\'' + arg.split(' ')[0] + '\';', (err, res) => {
          var data = res.rows[0];
          var ee = new Discord.RichEmbed();
          console.log(res.rows[0]);
          var userDist = discordClient.users.get(data.id)
          ee.setAuthor(userDist.username, userDist.avatarURL)
          ee.setDescription(`${data.nickname} is **${userDist.username}**#${userDist.discriminator} on discord.`);
          ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
          ee.setColor(COLORS.COMPLETE);
          message.channel.send({embed: ee})
        })
      }else{
        var userID = arg.replace(/\!|\@|<|>/gim, '');
        if(isNaN(+userID)){
          var associatedDiff = [];
          for(var [key, value] of discordClient.users){
            associatedDiff.push([key, levenshtein(userID, value.username)]);
            var member = message.guild.members.get(value.id);
            if(member && member.nickname){
              associatedDiff.push([key, levenshtein(userID, member.nickname)])
            }
          }
          associatedDiff = associatedDiff.sort(function(a, b){return a[1] - b[1];})
          userID = associatedDiff[0][0];
        }
        var userDist = discordClient.users.get(userID);
        if(userDist && +userID !== 1){
          queryI(userID, (err, res) => {
            if(err || res.rows.length !== 1){
              var potentialErrors = [
                "Perhaps they need a little, uh, motivation?",
                "Wow, they must just like being incognito.",
                "Ok, that is epic.",
                "Do you realize the scope of this situation and the implications it has on the society in which we live?",
                "What if they wanted to look up their own stats?",
                "Blaze does not approve of this message",
                "Does this text block help me to pass the Turing Test?",
                "We live in a society... that is ruined through this sort of thing. Dead meme, I know."
              ]
              dError(message, 'It looks like **' + userDist.username + '** hasn\'t connected their KA and discord accounts yet with `' + PREFIX + 'login`. *' + potentialErrors[Math.floor(Math.random()*potentialErrors.length)] + '*');
              return;
            }
            var data = res.rows[0];
            var ee = new Discord.RichEmbed();
            ee.setAuthor(userDist.username, userDist.avatarURL)
            ee.setDescription(`${userDist.username} is **${data.nickname}** *(@${data.username})*\n\n[Profile Link](https://www.khanacademy.org/profile/${data.username})`);
            ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
            ee.setColor(COLORS.COMPLETE);
            message.channel.send({embed: ee})
          })
        }
      }
    },
    documentation: "This command allows the user to see who another user is on KA. You can ping them or type their name or nickname. Additionally, you can say \"on discord\" to do an exact username search like such: `" + PREFIX + "whois user on discord`"
  },
  setLoginChannel: {
    run(message, args){
      pgSQLClient.query("UPDATE servers SET login_channel=$1 WHERE id=$2;", [args.replace(/<|#|>/gim, ''), message.guild.id])
        .then(resd => {
          console.log('[UKB] Data uploaded!');
          var ee = new Discord.RichEmbed();
          ee.setAuthor('The login channel is now <#' + res.rows[0].login_channel + ">.")
          ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
          ee.setColor(COLORS.COMPLETE);
          message.channel.send({embed: ee})
        })
        .catch(e => console.error(e.stack))
    },
    documentation: "Sets login channel. You can ping the channel or input an id. In the future, you may be able to type the name of the channel.", // @TODO in the future do that <----
    permissions: ["MANAGE_GUILD", "MANAGE_CHANNELS"]
  },
  setLoginMandatory: {
    run(message, args){
      pgSQLClient.query("SELECT * FROM servers WHERE id=$1", [message.guild.id])
        .then(res => {
          pgSQLClient.query("UPDATE servers SET login_mandatory=$1 WHERE id=$2;", [+(!+res.rows[0].login_mandatory), message.guild.id])
            .then(resd => {
              console.log('[UKB] Data uploaded!');
              var ee = new Discord.RichEmbed();
              ee.setAuthor('Login is now ' + ((+res.rows[0].login_mandatory === 1) ? "not " : "") + "mandatory.")
              ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
              ee.setColor(COLORS.COMPLETE);
              message.channel.send({embed: ee})
            })
        })
    },
    documentation: "Toggles login being mandatory for server entrance. Make sure to disable the verified role and its permissions before making login not mandatory.",
    permissions: ["MANAGE_GUILD", "MANAGE_CHANNELS"]
  },
  serverStats: {
    run(message, args){
      pgSQLClient.query("SELECT * FROM servers WHERE id=$1", [message.guild.id])
        .then(res => {
          var ee = new Discord.RichEmbed();
          ee.setAuthor(message.guild.name, message.guild.iconURL);
          ee.addField('id', message.guild.id);
          ee.addField('Number of members', message.guild.memberCount);
          ee.addField('Owner', message.guild.owner);
          ee.addField('Login Channel', res.rows[0].login_channel === '1' ? 'Unset' : '<#' + res.rows[0].login_channel + '>')
          ee.addField('Login Mandatory', ((+res.rows[0].login_mandatory === 0) ? "Not " : "") + "Mandatory")
          ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
          ee.setColor(COLORS.COMPLETE);
          message.channel.send({embed: ee})
        })
    },
    documentation: 'Collects server statistics helpful to automatic role generation, etc.'
  },
  generateVerifiedRole: {
    run(message, args){
      pgSQLClient.query("SELECT * FROM servers WHERE id=$1", [message.guild.id])
        .then(res => {
          if(res.rows[0].login_channel === '1'){
            dError(message, "You need a login channel in order to make a verified role!");
          }else{
            if(res.rows[0].login_mandatory.toString() === '0'){
              dError(message, "Login must be mandatory for this to work!");
            }else{
              var loginChannel = message.guild.channels.get(res.rows[0].login_channel);
              var everyone = message.guild.roles.first();
              var verified, PermissionError = false;
              if(!message.guild.roles.find('name', 'Verified')){
                message.guild.createRole({
                  name: 'Verified'
                })
                .catch(e => {
                  dError(message, "I don't have permisions to do this!");
                  PermissionError = true;
                })
              }
              if(PermissionError) return; // @TODO remove these and just kill the command after a permission error
              verified = message.guild.roles.find('name', 'Verified');
              everyone.setPermissions(['SEND_MESSAGES', 'READ_MESSAGE_HISTORY'], 'Automatic Verified role generation')
                .catch(e => {
                  dError(message, "I don't have permisions to do this!");
                  PermissionError = true;
                })
              if(PermissionError) return;
              verified.setPermissions(['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS', 'ATTACH_FILES', 'READ_MESSAGE_HISTORY', 'USE_EXTERNAL_EMOJIS'], 'Automatic Verified role generation')
              loginChannel.overwritePermissions(everyone, {
                VIEW_CHANNEL: true,
                SEND_MESSAGES: true
              })
              loginChannel.overwritePermissions(verified, {
                VIEW_CHANNEL: false,
                SEND_MESSAGES: false
              })
              var pleaseLogin = new Discord.RichEmbed();
              pleaseLogin.setAuthor(message.guild.name, message.guild.iconURL);
              pleaseLogin.setDescription('Hello! The administrators of this server have made KA login mandatory for entrance. In order to enter this server, type `' + PREFIX + 'login` and send it in this channel. You will get connection instructions in DM.')
              pleaseLogin.setColor(COLORS.ERROR);
              loginChannel.send({embed: pleaseLogin});

              var loginEnabled = new Discord.RichEmbed();
              loginEnabled.setAuthor(message.guild.name, message.guild.iconURL);
              loginEnabled.setDescription('Verified role generated. Locked channels for non-verified users. Searching for previously logged-in users...')
              loginEnabled.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
              loginEnabled.setColor(COLORS.COMPLETE);
              message.channel.send({embed: loginEnabled})
                .then((sentEmbed) => {
                  pgSQLClient.query('SELECT * FROM users;', [])
                    .then(result => {
                      console.log(result);
                      var addedToMembers = 0;
                      for(var member of message.guild.members){
                        if(result.rows.find(el => el.id === member[0])){
                          member[1].addRole(verified, 'KAID: ' + result.rows[result.rows.findIndex(el => el.id === member[0])].kaid);
                          addedToMembers++;
                        }
                      }
                      loginEnabled.addField('Users Found', addedToMembers);
                      sentEmbed.edit({embed: loginEnabled});
                    })
                })
            }
          }
        })
    },
    documentation: 'Generates automatic verified role.',
    permissions: ["MANAGE_GUILD", "MANAGE_CHANNELS"]
  },
  delete: {
    run(message, arg){
      message.channel.fetchMessages({limit: +arg+1})
        .then(c => {
          var q = c.deleteAll()
            q[q.length-1].then(() => {
              var ee = new Discord.RichEmbed();
              ee.setAuthor('Deleted ' + (q.length-1) + ' messages.');
              ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
              ee.setColor(COLORS.COMPLETE);
              message.channel.send({embed: ee})
            })
        });
    },
    documentation: 'Deletes `x` amount of messages. Bulk deletion past two weeks will not work and will throw an error.',
    permissions: ["MANAGE_MESSAGES"]
  },
  getPoints: {
    run(message, arg){
      var bb = new Discord.RichEmbed();
      bb.setAuthor('Loading...', message.author.avatarURL);
      bb.setColor(COLORS.ERROR);
      message.channel.send({embed: bb})
        .then(m => {
          queryI(message.author.id, (err, res) => {
            client.auth(res.rows[0].token, res.rows[0].secret)
              .get("/api/v1/user", { casing: "camel" })
              .then(response => {
                if(typeof response.body !== 'object') response.body = JSON.parse(response.body);
                var url = "https://www.khanacademy.org/api/internal/user/discussion/statistics?kaid=" + res.rows[0].kaid;
                request(url, (err, resp, body) => {
                  if(typeof body !== 'object') body = JSON.parse(body);
                  var totalPoints = Math.round(response.body.points / 1500) + response.body.badgeCounts['0'] * 5 + response.body.badgeCounts['1'] * 10 + response.body.badgeCounts['2'] * 15 + response.body.badgeCounts['3'] * 50 + response.body.badgeCounts['4'] * 100 + response.body.badgeCounts['5'] * 20 + Math.round(response.body.totalSecondsWatched / 1000) + body.answers + body.projectanswers * 2;
                  var ee = new Discord.RichEmbed();
                  ee.setAuthor('UKAB Points for ' + message.author.username, message.author.avatarURL);
                  ee.setDescription('You have **' + totalPoints + '** points. You have gained **' + (totalPoints - +res.rows[0].ukab_points) + '** since your last update!');
                  ee.addField('\u200b', 'The points are calculated by a formula that takes into account your KA points, weighted badge counts, videos watched, answers, and project help request answers. Try to get as many of these as possible!')
                  ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
                  ee.setColor(COLORS.COMPLETE);
                  m.edit({embed: ee})
                  pgSQLClient.query("UPDATE users SET ukab_points=$1 WHERE id=$2;", [totalPoints, message.author.id])
                    .then(resd => {
                      console.log('[UKB] Data uploaded!');
                    })
                })
              });
          });
        })
    },
    documentation: 'Updates your UKAB Points. A full description can be found in the command itself.'
  }
}
commands.help = {
  run(message, arg){
    if(arg === ''){
      var ee = new Discord.RichEmbed();
      ee.setTitle('Full Command Database')
      ee.setDescription(`The current commands are: ${PREFIX}**${Object.keys(commands).join('**, ' + PREFIX + '**')}**`);
      ee.setFooter(`Run ${PREFIX}help [command] to find out more information about each specific command.`)
      ee.setColor(COLORS.COMPLETE);
      message.channel.send({embed: ee})
    }else{
      if(commands[arg]){
        var ee = new Discord.RichEmbed();
        ee.setTitle(PREFIX + arg + ' Help')
        ee.setDescription(commands[arg].documentation);
        ee.setFooter(`Run ${PREFIX}help [command] to find out more information about each specific command.`)
        ee.setColor(COLORS.COMPLETE);
        message.channel.send({embed: ee})
      }else{

      }
    }
  }
}
for(var i in commands){
  if(commands[i] && !commands[i].permissions) commands[i].permissions = ['READ_MESSAGE_HISTORY'];
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
        console.log('[UKB] Tokens accessed. Getting profile information...')
        client.auth(token, tokenSecret)
          .get("/api/v1/user", { casing: "camel" })
          .then(response => {
            if(typeof response.body !== 'object') response.body = JSON.parse(response.body);
            var rem = new Discord.RichEmbed();
            rem.setDescription(['Heya', 'Hello', 'Hi', 'Sup', 'Welcome'][Math.floor(Math.random()*5)] + ', **' + response.body.studentSummary.nickname + '**!')
            rem.setFooter('You\'re all set up!');
            rem.setColor('#BADA55');
            discordClient.users.get(id).send({embed: rem})
            queryI(id, (err, res) => {
              console.log(err, res.rows);
              if(err || res.rows.length !== 1){
                pgSQLClient.query('INSERT INTO users VALUES($1, $2, $3, $4, $5, $6, $7, $8)', [id, token, tokenSecret, response.body.username, response.body.studentSummary.nickname, response.body.kaid, new Date().toString(), '0'])
                  .then(resd => {
                    console.log('[UKB] Data uploaded!');
                    delete users[i];
                  })
                  .catch(e => console.error(e.stack))
                pgSQLClient.query('SELECT * FROM servers;', [])
                  .then(resd => {
                    for(var server of resd.rows){
                      if(server.login_mandatory){
                        var member = discordClient.guilds.get(server.id).members.get(id);
                        member.addRole(member.guild.roles.find('name', 'Verified'), 'KAID: ' + response.body.kaid);
                      }
                    }
                  })
              }
            })
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
  discordClient.user.setPresence({ game: { name: DEBUG ? ('UKAB Beta | ' + PREFIX + "help") : ('Version ' + version + " | " + PREFIX + "help") }, status: 'idle' })
  if(!DEBUG){
    interval = setInterval(function(){
      request('http://ukb.herokuapp.com/', (err, res) => {
        var acceptEmbed = new Discord.RichEmbed();
        acceptEmbed.setTitle('Statistics');
        acceptEmbed.setDescription('Number of commands run this cycle: **' + commandsRun + '**');
        acceptEmbed.setFooter('This data reloads every 20 minutes.');
        acceptEmbed.addField('Errors', err ? err.stack : 'none')
        acceptEmbed.setColor(COLORS.INFORMATION);
        discordClient.channels.get(RELOAD_CHANNEL).send({embed: acceptEmbed});
        commadsRun = 0;
      })
    }, 1200000)
  }
});
discordClient.on('message', (message) => {
  if(message.content.startsWith(PREFIX)){
    var command = message.content.replace(PREFIX, '').split(' ')[0];
    var arg = message.content.substr(command.length + PREFIX.length + 1, message.content.length-1)
    var member = message.guild.members.get(message.author.id);
    if(commands[command]){
      if(member.permissions.has(commands[command].permissions)){
        commandsRun++;
        commands[command].run(message, arg, member);
      }else{
        message.channel.send('cant')
      }
    }else{
      message.channel.send('no')
    }
  }
});
discordClient.on('guildCreate', (guild) => {
  var potentialChannels = [];
  for(var i = 0; i < guild.channels.array().length; i++){
    if(guild.channels.array()[i].name.match(/login|entrance|welcome|exit/gim)){
      potentialChannels.push(guild.channels.array()[i].id);
    }
  }
  potentialChannels.sort((a, b) => a.length - b.length);
  pgSQLClient.query('INSERT INTO servers VALUES($1, $2, $3)', [guild.id, 0, potentialChannels[0] || '1'])
    .then(resd => {
      console.log('[UKB] Data uploaded to servers!');
    })
    .catch(e => console.error(e.stack))
})
discordClient.on('guildMemberAdd', (member) => {
  pgSQLClient.query('SELECT * FROM servers WHERE id=$1;', [member.guild.id])
    .then(res => {
      console.log(res.rows[0])
      if(res.rows[0].login_mandatory.toString() === '1'){
        pgSQLClient.query('SELECT * FROM users WHERE id=$1;', [member.id])
          .then(resUSERS => {
            if(!resUSERS.rows[0]){
              var pleaseLogin = new Discord.RichEmbed();
              pleaseLogin.setAuthor(member.guild.name, member.guild.iconURL);
              pleaseLogin.setDescription('Hello, ' + member + '! The administrators of this server have made KA login mandatory for entrance. In order to enter this server, type `' + PREFIX + 'login` and send it in this channel. You will get connection instructions in DM.')
              pleaseLogin.setColor(COLORS.ERROR);
              member.guild.channels.get(res.rows[0].login_channel).send({embed: pleaseLogin});
            }else{
              member.addRole(member.guild.roles.find('name', 'Verified'), 'KAID: ' + resUSERS.rows[0].kaid);
            }
          })
      }
    })
})

// Process handlers
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
