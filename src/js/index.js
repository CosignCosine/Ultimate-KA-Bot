const DEBUG = false,
      PREFIX = DEBUG ? '_ka!' : 'ka!',
      COLORS = {
        INFORMATION: '#ff9595',
        COMPLETE: '#b44949',
        ERROR: '#FF0000'
      },
      RELOAD_CHANNEL = '460219376654876673',
      PING_USER = '198942810571931649', // Scott
      CALLBACK_URL = ['http://ukb.herokuapp.com/login/', 'http://localhost/login/'][DEBUG&1],
      KA = 'www.khanacademy.org',
      PORT = process.env.PORT || 80,
      FUN_WORDS = {
        'this is so sad': 'alexa play despacito',
        'can we get 50 likes': 'no',
        'tucker is better': 'die lol',
        'eat the pant': 'angerful',
        'help': 'what if i refuse',
        'turing test': ':sunglasses: haha no',
        'rarted': 'no u'
      };

// Requirements and instantiation
const Discord = require('discord.js'),
      fs = require('fs'),
      request = require('request'),
      express = require('express'),
      webClient = express(),
      OAuth1Client = require("oauth-1-client"),
      levenshtein = require('js-levenshtein'),
      { Client } = require('pg'),
      readline = require('readline'),
      timeAgo = require('node-time-ago');

var version = '0.0.0', // Bot version, defaults to 0.0.0
    interval,         // Self-pinging interval (for iife)
    badgeCache = [], // Badge cache (will be filled with badges, destroyed on bot reload)
    discordClient = new Discord.Client(), // New Discord client
    commandsRun = 0, // Total commands run
    markedForReLogin = [], // An array of people who need to re-login to their accounts.
    { TOKEN, SECRET, KEY, DATABASE_URL, HOOK_KEY, HOOK_ID } = process.env; // token, secret, key, etc, needed for login and set by env vars

// Fill badge cache
request("https://www.khanacademy.org/api/v1/badges", function(error, response, body){
  if (!error && response && response.statusCode === 200) {
    var badges = JSON.parse(body);
    for (var i = 0; i < badges.length; i++) {
        badgeCache[badges[i].description.toLowerCase()] = {
            name: badges[i].description,
            url: badges[i].absolute_url,
            icon: badges[i].icons.compact,
            description: badges[i].translated_safe_extended_description,
            points: badges[i].points,
            category: ['Meteorite', 'Moon', 'Earth', 'Sun', 'Black Hole', 'Challenge Patch'][badges[i].badge_category],
            color: ['#bf4028', '#136a73', '#4fb365', '#f9a11b', '#bd207b', '#3ba4bd'][badges[i].badge_category]
        };
    }
  }
})

// Get version
fs.readFile(__dirname + '/../../package.json', 'utf-8', (err, response) => {
  var data = JSON.parse(response);
  version = data.version;
})

// Use debug parameters
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
  HOOK_KEY = dbTokens.hook_key;
  HOOK_ID = dbTokens.hook_id;
}

// Readline evaluation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
function consoleEvaluation(){
  rl.question('[UKB] Console evaluation open. Type a valid javascript expression for execution.', (answer) => {
    console.log(`[UKB] Evaluating: ${answer}`);
    eval(answer);
    consoleEvaluation();
  });
};
consoleEvaluation();

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
Object.filter = (obj, predicate) => Object.keys(obj).filter( key => predicate(obj[key]) ).reduce( (res, key) => (res[key] = obj[key], res), {} );
var confirmation = (message, channel) => { // Message received, data will be sent
      if(!channel) channel = message.channel.id;
      var acceptEmbed = new Discord.RichEmbed();
      acceptEmbed.setTitle('Information');
      acceptEmbed.setDescription('Data has been sent to your DMs.');
      acceptEmbed.setFooter('Please make sure to have direct messages for this server enabled, or you will not get the data.')
      acceptEmbed.setColor(COLORS.INFORMATION);
      discordClient.channels.get(channel).send({embed: acceptEmbed});
    },
    dError = (message, messageContent) => { // Generic error object
      var ee = new Discord.RichEmbed();
      ee.setTitle('Error!')
      ee.setDescription(messageContent);
      ee.setColor(COLORS.ERROR);
      message.channel.send({embed: ee});
    },
    handleShutdown = (type, err, noKill) => { // Shutdown callback
      var ll = new Discord.RichEmbed();
      ll.setTitle('Shutdown');
      ll.setDescription(`Shutdown type is **${type}**.`);
      ll.setColor(COLORS.ERROR);
      if(err) ll.addField('Error', (err.stack || err).substr(0, 1017) + (((err.stack || err).length > 1017) ? '[...]' : '\u200b'));
      discordClient.channels.get(RELOAD_CHANNEL).send(discordClient.users.get(PING_USER).toString(), {embed: ll})
        .then(m=>{
          if(!noKill){
            discordClient.destroy()
              .then(()=>{
                console.log('[UKB] Destroyed Discord client, killed process with exit type 0.')
                clearInterval(interval);
                process.exit()
              }).catch(e => {
                console.log('[UKB] Error:' + e);
              })
          }
        })
    },
    queryUsers = (id, callback) => { // user query
      pgSQLClient.query('SELECT * FROM users WHERE ID = \'' + id + '\';', callback);
    },
    resolveUsername = (userID, guild) => { // get discord username and ka account data from id and optionally the guild as well
      return new Promise((resolve, reject) => {
        if(!discordClient.readyAt){
          reject('Discord client is not ready.')
        }
        userID = userID.replace(/\!|\@|<|>/gim, '');
        if(isNaN(+userID)){
          var associatedDiff = [];
          for(var [key, value] of discordClient.users){
            if(value.id !== '1'){
              associatedDiff.push([key, levenshtein(userID, value.username)]);
              var member;
              if(guild){
                member = guild.members.get(value.id);
                if(member && member.nickname){
                  associatedDiff.push([key, levenshtein(userID, member.nickname)])
                }
              }
            }
          }
          associatedDiff = associatedDiff.sort(function(a, b){return a[1] - b[1];})
          userID = associatedDiff[0][0];
        }
        var userDist = discordClient.users.get(userID);
        if(userDist && userID !== '1'){
          queryUsers(userID, (err, res) => {
            if(err){
              reject('User has not connected their KA account.')
            }
            var data = {dbKAUser: res.rows[0], discordUser: userDist}
            resolve(data);
          })
        }else{
          reject('User could not be found in the cache.')
        }
      })
    }

// PostgreSQL client login
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
    console.log('[UKB] Error:' + e.stack);
  })

// Commands
var commands = {
  login: {
    run(message, arg){
      if(DEBUG){
        dError(message, 'Sorry, this command is only available in non-debug mode. Please use the official bot or reload the bot with `DEBUG` set to `false`.');
        return;
      }
      queryUsers(message.author.id, (err, res) => {
        if(err || res.rows.length !== 1 || markedForReLogin.includes(message.author.id)){
          var acceptEmbed = new Discord.RichEmbed();
          acceptEmbed.setTitle('KA Login');
          acceptEmbed.setDescription('Instructions have been sent to your direct messages.');
          acceptEmbed.setFooter('Please make sure to have direct messages for this server enabled, or you will not get the login URL. Additionally, keep in mind that by logging in, you agree to Khan Academy\'s Terms of Service.')
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
  banned: {
    run(message, arg){
      queryUsers(message.author.id, (err, res) => {
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
      if(arg === '') arg = message.author.username;
      if(message.content.replace(/\W+/gim, '').match(/ondiscord/gim)){
        pgSQLClient.query('SELECT * FROM users WHERE username=$1;', [arg.split(' ')[0]], (err, res) => {
          if(err) throw err;
          var data = res.rows[0];
          if(!data){
            dError(message, 'User is not on discord.');
          }else{
            if(!+data.private){
              var ee = new Discord.RichEmbed();
              var userDist = discordClient.users.get(data.id)
              ee.setAuthor(userDist.username, userDist.avatarURL)
              ee.setDescription(`${data.nickname} is **${userDist.username}**#${userDist.discriminator} on discord.`);
              ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
              ee.setColor(COLORS.COMPLETE);
              message.channel.send({embed: ee})
            }else{
              dError(message, 'This user\'s profile is private!');
            }
          }
        })
      }else{
        resolveUsername(arg, message.guild)
          .then(({dbKAUser, discordUser}) => {
            if(!dbKAUser){
              console.log(dbKAUser, discordUser);
              throw 'User not found in database.';
            }
            if(!!+dbKAUser.private){
              dError(message, 'Their account is private!');
            }else{
              console.log(dbKAUser)
              client.auth(dbKAUser.token, dbKAUser.secret)
                .get('/api/v1/user/', {casing: 'camel'})
                .then(response => {
                  console.log(response.body)
                  var ee = new Discord.RichEmbed();
                  ee.setAuthor(discordUser.username, discordUser.avatarURL)
                  ee.setDescription(`${discordUser.username} is **${dbKAUser.nickname}** *(@${dbKAUser.username !== '' ? dbKAUser.username : dbKAUser.kaid})*\n\n[Profile Link](https://www.khanacademy.org/profile/${dbKAUser.username !== '' ? dbKAUser.username : dbKAUser.kaid})`);
                  ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
                  ee.setColor(COLORS.COMPLETE);
                  message.channel.send({embed: ee})

                  // if changed, put info in database
                })
            }
          })
          .catch((e) => {
            dError(message, e.stack || e);
          })

      }
    },
    documentation: "This command allows the user to see who another user is on KA. You can ping them or type their name or nickname. Additionally, you can say \"on discord\" to do an exact username search like such: `" + PREFIX + "whois user on discord`"
  },
  test: {
    run(message, arg){
      if(DEBUG){
        queryUsers(message.author.id, (err, res) => {
          if(err || res.rows.length !== 1){
            dError(message, 'It looks like you haven\'t yet set up a profile with `' + PREFIX + 'login`. Please run that command before trying to get private statistics about your account!');
            return;
          }
          client.auth(res.rows[0].token, res.rows[0].secret)
            .post("/api/internal/discussions/scratchpad/6389992281473024/comments", {text: 'hello tis i the living meme come to steal your oauth', topic_slug: 'computer-programming'})
            .then(response => {
              console.log(response, response.body);
            })
            .catch(console.error)
        })
      }else{
        dError(message, 'Command not available outside of beta.')
      }
    },
    documentation: 'A testing ground for new functions. Only available in debug.'
  },
  eval: {
    run(message, arg){
      try{
        var ev = new Discord.RichEmbed().setTitle('Evaluation').setDescription('```javascript\n' + arg + '``` evaluates to `'+ eval(arg) +'`').setColor(COLORS.COMPLETE).setFooter(new Date());
        message.channel.send({embed: ev})
      }catch(e){
        dError(message, e)
      }
    },
    documentation: 'exploit this i dare you hahahahahahAHAHAHAHAHAHAHAHA',
    users: [PING_USER]
  },
  badge: {
    run(message, arg){
      var tArg = arg, arg = arg.replace(/--\w+/gim, '').trim().toLowerCase();
      if(tArg.match(/--owned/gim)){
        message.channel.send('Loading...')
          .then(m => {
            queryUsers(message.author.id, (err, res) => {
              if(!res.rows[0]){
                dError(message, 'Account not connected!');
                return;
              }
              client.auth(res.rows[0].token, res.rows[0].secret)
                .get("/api/v1/badges", { casing: "camel" })
                .then(response => {
                  if(typeof response.body !== 'object') response.body = JSON.parse(response.body);
                  var badges = {};
                  for(var i = 0; i < response.body.length; i++){
                    badges[response.body[i].description.toLowerCase()] = response.body[i];
                  }
                  if(badges[arg]){
                    var badge = badges[arg];
                    console.log(badge)
                    var badgeEmbed = new Discord.RichEmbed();
                    badgeEmbed.setTitle(badge.description);
                    badgeEmbed.setDescription(badge.translatedSafeExtendedDescription);
                    badgeEmbed.setThumbnail(badge.icons.compact);
                    badgeEmbed.setURL(badge.absoluteUrl);
                    badgeEmbed.setColor(['#bf4028', '#136a73', '#4fb365', '#f9a11b', '#bd207b', '#3ba4bd'][badge.badgeCategory]);
                    badgeEmbed.addField('Points Given', badge.points);
                    badgeEmbed.addField('Category', ['Meteorite', 'Moon', 'Earth', 'Sun', 'Black Hole', 'Challenge Patch'][badge.badgeCategory]);
                    badgeEmbed.addField('Owned?', badge.isOwned ? 'Yes' : 'No');
                    badgeEmbed.addField('Retired?', badge.isRetired ? 'Yes' : 'No')
                    if(badge.isOwned) badgeEmbed.addField('# Owned', badge.userBadges.length);
                    if(badge.isOwned) badgeEmbed.addField('Date Last Acquired', timeAgo(badge.userBadges[0].date));
                    m.edit({embed: badgeEmbed});
                  }else{
                    m.delete();
                    dError(message, 'Badge not found on KA or in your profile. Are you sure you spelled it correctly?');
                  }
                })
            })
          })
      }else{
        if(badgeCache[arg]){
          var badge = badgeCache[arg];
          var badgeEmbed = new Discord.RichEmbed();
          badgeEmbed.setTitle(badge.name);
          badgeEmbed.setDescription(badge.description);
          badgeEmbed.setThumbnail(badge.icon);
          badgeEmbed.setURL(badge.url);
          badgeEmbed.setColor(badge.color);
          badgeEmbed.addField('Points Given', badge.points);
          badgeEmbed.addField('Category', badge.category);
          message.channel.send({embed: badgeEmbed});
        }else{
          dError(message, 'Badge not found on KA. Are you sure you spelled it correctly and that it\'s not a private badge?');
        }
      }
    },
    documentation: "This command finds a badge based on its name, e.g.: `" + PREFIX + "badge Picking Up Steam`. If you add the --owned flag, it will return a boolean that says whether you have the badge or not. (Note: this flag will only work on your account.)"
  },
  setLoginChannel: {
    run(message, args){
      pgSQLClient.query("UPDATE servers SET login_channel=$1 WHERE id=$2;", [args.replace(/<|#|>/gim, ''), message.guild.id])
        .then(resd => {
          console.log('[UKB] Data uploaded! ', resd.rows);
          var ee = new Discord.RichEmbed();
          ee.setAuthor('The login channel is now <#' + resd.rows[0].login_channel + ">.")
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
  setStarboardChannel: {
    run(message, args){
      pgSQLClient.query("SELECT * FROM servers WHERE id=$1", [message.guild.id])
        .then(resulting => {
          var starboardPrefs = JSON.parse(resulting.rows[0].starboard_config);
          starboardPrefs.channel = args.replace(/<|#|>/gim, '');
          pgSQLClient.query("UPDATE servers SET starboard_config=$1 WHERE id=$2;", [JSON.stringify(starboardPrefs), message.guild.id])
            .then(resd => {
              console.log('[UKB] Data uploaded!');
              var ee = new Discord.RichEmbed();
              ee.setAuthor('The starboard channel is now <#' + starboardPrefs.channel + ">.")
              ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
              ee.setColor(COLORS.COMPLETE);
              message.channel.send({embed: ee})
            })
            .catch(e => console.error(e.stack))
        })
    },
    documentation: "Sets starboard channel (requires manage channels)",
    permissions: ["MANAGE_GUILD", "MANAGE_CHANNELS"]
  },
  setStarboardThreshold: {
    run(message, args){
      pgSQLClient.query("SELECT * FROM servers WHERE id=$1", [message.guild.id])
        .then(resulting => {
          var starboardPrefs = JSON.parse(resulting.rows[0].starboard_config);
          starboardPrefs.threshold = args;
          pgSQLClient.query("UPDATE servers SET starboard_config=$1 WHERE id=$2;", [JSON.stringify(starboardPrefs), message.guild.id])
            .then(resd => {
              console.log('[UKB] Data uploaded!');
              var ee = new Discord.RichEmbed();
              ee.setAuthor('The starboard threshold is now ' + starboardPrefs.threshold + ".")
              ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
              ee.setColor(COLORS.COMPLETE);
              message.channel.send({embed: ee})
            })
            .catch(e => console.error(e.stack))
        })
    },
    documentation: "Sets starboard threshold",
    permissions: ["MANAGE_GUILD", "MANAGE_CHANNELS"]
  },
  toggleAccountPrivate: {
    run(message, args){
      pgSQLClient.query("SELECT * FROM users WHERE id=$1", [message.author.id])
        .then(res => {
          pgSQLClient.query("UPDATE users SET private=$1 WHERE id=$2;", [+(!+res.rows[0].private), message.author.id])
            .then(resd => {
              console.log('[UKB] Data uploaded!');
              var ee = new Discord.RichEmbed();
              ee.setAuthor('Your account is now ' + ((res.rows[0].private === '1') ? "public" : "private") + ".")
              ee.setFooter('Called by ' + message.author.username + '#' + message.author.discriminator)
              ee.setColor(COLORS.COMPLETE);
              message.channel.send({embed: ee})
            })
        })
    },
    documentation: "Toggles your KA account being private. This keeps your account linked but does not display its name or information. Note: **This is not recommended.**"
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
  stats: {
    run: async function(message, arg){
      if(arg === "") arg = message.author.id;
      var uname, _private = false, kill = false;
      if(!arg.startsWith('@')){
        uname = await resolveUsername(arg, message.guild);
        console.log(uname);
        if(!uname || !uname.dbKAUser){
          kill = true;
        }else{
          if(!!+uname.dbKAUser.private){
            _private = true;
          }
          uname = uname.dbKAUser.kaid;
        }
      }else{
        uname = arg.split(' ')[0].replace(/@/gim, '');
      }
      if(_private){
        dError(message, 'This account is private!');
        return;
      }
      if(kill){
        dError(message, 'User could not be found in guild.');
        return;
      }
      request('https://www.khanacademy.org/api/internal/user/profile?kaid=' + uname, (err, res, body) => {
        if(err){
          dError(message, 'Khan Academy\'s API seems to be down.')
        }
        body = body instanceof Object ? body : JSON.parse(body);

        if(body == null){
          dError(message, 'This user could not be found or is child-accounted.')
        }else{
          var db = new Discord.RichEmbed();
          db.setAuthor(body.nickname + " (@" + (body.username !== '' ? body.username : body.kaid) + ")", body.avatar.imagePath.replace(/\/images\/avatars\/(?:svg\/)?(.*?)\.(?:svg|png)/ig, (match, g) => `https://www.kasandbox.org/programming-images/avatars/${g}.png`));
          db.setDescription(body.bio.length > 0 ? body.bio : '\u200b')
          db.setImage(body.backgroundSrc)
          db.addField('Energy Points', body.points.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")) // https://stackoverflow.com/questions/2901102/how-to-print-a-number-with-commas-as-thousands-separators-in-javascript
          db.addField('Last Streak Length', body.streakLastLength + ' days')
          db.addField('KAID', body.kaid)
          db.setFooter(body.userLocation.displayText);
          db.setColor(COLORS.COMPLETE)
          message.channel.send({embed: db})
        }
      })
    },
    documentation: 'Gets statistics about a user\'s KA account. To use a KA username, add \'@\' before the username, like such: `' + PREFIX + 'stats @username`'
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
              verified.setPermissions(['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS', 'ATTACH_FILES', 'READ_MESSAGE_HISTORY', 'USE_EXTERNAL_EMOJIS', 'CONNECT', 'SPEAK', 'USE_VAD', 'CHANGE_NICKNAME'], 'Automatic Verified role generation')
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
          queryUsers(message.author.id, (err, res) => {
            client.auth(res.rows[0].token, res.rows[0].secret)
              .get("/api/v1/user", { casing: "camel" })
              .then(response => {
                if(typeof response.body !== 'object') response.body = JSON.parse(response.body);
                request("https://www.khanacademy.org/api/internal/user/discussion/statistics?kaid=" + res.rows[0].kaid, (err, resp, body) => {
                  if(typeof body !== 'object') body = JSON.parse(body);
                  var totalPoints = Math.round(response.body.points / 2500) + response.body.badgeCounts['0'] * 5 + response.body.badgeCounts['1'] * 10 + response.body.badgeCounts['2'] * 15 + response.body.badgeCounts['3'] * 50 + response.body.badgeCounts['4'] * 100 + response.body.badgeCounts['5'] * 20 + Math.round(response.body.totalSecondsWatched / 1000) + body.answers * 5 + body.projectanswers * 2;
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
  },
  leaderboard: {
    run(message, args){
      pgSQLClient.query('SELECT * FROM users;')
        .then(res => {
          var _args = args;
          if(args === "" || args === "--guild" || +args < 1) args = "1";

          // data filter
          var data = res.rows.sort((a, b) => +a.ukab_points - +b.ukab_points).reverse().filter(q => !!(_args.match(/--guild/gim) ? message.guild.members.get(q.id) : q)).slice(0 + (+args - 1) * 10, 10 + (+args - 1) * 10);

          if(data.length > 0){
            var cc = new Discord.RichEmbed();
            cc.setColor(COLORS.COMPLETE);
            var str = "```md\n";
            console.log(discordClient.users)
            for(var i = 0; i < data.length; i++){
              if(discordClient.users.get(data[i].id)){
                var userStr = discordClient.users.get(data[i].id).username + "#" + discordClient.users.get(data[i].id).discriminator + ' (@' + (data[i].private.toString()==='1' ? '[REDACTED]' : (data[i].username !== '' ? data[i].username : data[i].kaid)) + ")";
                str += '' + (((+args-1)*10) + (+i+1)) + '. ' + userStr + '\n' + data[i].ukab_points + ' points\n\n';
              }
            }
            str += "```";
            cc.setAuthor('Bot Points Leaderboard for ' + message.guild.name, message.guild.iconURL)
            cc.setDescription(str);
            message.channel.send({embed: cc})
          }else{
            dError(message, 'There aren\'t this many users!')
          }
        })
    },
    documentation: 'Gets the leaderboard for UKAB points.'
  },
  announcement: {
    run(message, arg){
      console.log(HOOK_ID, HOOK_KEY)
      const hook = new Discord.WebhookClient(HOOK_ID, HOOK_KEY);
      const emb = new Discord.RichEmbed();
      emb.setAuthor(message.guild.name, message.guild.iconURL);
      emb.setDescription(arg);
      emb.setFooter(new Date())
      emb.setColor('#f4637c');
      hook.send({
        embeds: [emb]
      }).then( l => { console.log('[UKB] Announcement made'); })
    },
    documentation: 'Makes a new announcement',
    permissions: ["ADMINISTRATOR"]
  },
  oopsify: {
    run(message, arg){
      var oops = arg.replace(/\@everyone|\@here/gim, '').replace(/\.\.\./gim, '.').replace(/^\b\w|[\.!?]\W+\w/gim, (match) => {
        return match.toUpperCase();
      })
      if(Math.random() < 0.7){
        oops = oops.replace(/([\!\.\?])/gim, function(a, b) {return b + (Math.random() < 0.6 ? "ENDSENT" : "");}).split(/ENDSENT/g);
        var whoopsies = "";
        for(var i = 0; i < oops.length; i++) {
            whoopsies += (i + 1) + ". " + oops[i].trim() + (i+1!==oops.length ? "\u2435" : "");
        }
        oops = whoopsies;
      }
      oops = oops.replace(/[^0-9](\.)/gim, (match) => {
        return match.replace(/\./gm, '') + ('!'.repeat(Math.floor(Math.random()*5)) + '?'.repeat(Math.floor(Math.random()*5))).split('').sort(function(){return 0.5-Math.random()}).join('');
      }).replace(/(\s)/gim, (match) => {
        var xD = Math.floor(Math.random()*18);
        return [' :) ', ' :( ', ' o\\_O ', ' ^.^ ', ' -\\_- ', ' xD ', ' ^-^ ', ' 8D ', ' :D ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '][xD]
      }).replace(/\u2435/gim, '\n') + "!!";
      message.channel.send(oops)
        .catch(e => {
          message.channel.send(':( I don\'t think I can send it, it\'s a bit too long!! o\\_O')
        })
    },
    documentation: 'Does some stuff to messages!!?! o_O'
  }
}
commands.help = {
  run(message, arg, member){
    if(arg === ''){
      var prunedCommands = Object.filter(commands, el => member.permissions.has(el.permissions));
      var ee = new Discord.RichEmbed();
      ee.setTitle('Command Database')
      ee.setDescription(`The current commands are: ${PREFIX}**${Object.keys(prunedCommands).join('**, ' + PREFIX + '**')}**`);
      if(Object.keys(prunedCommands).length != Object.keys(commands).length){
        ee.addField('Note', 'These are not all commands that the bot can run. These commands are the ones that are available for you to run on this server. If you had more permissions, more commands would be available on this list.')
      }
      ee.setFooter(`Run ${PREFIX}help [command] to find out more information about each specific command.`)
      ee.addField('Need help with using Discord?', 'This [link](https://support.discordapp.com/hc/en-us/articles/219470277-Getting-Started) may help.')
      ee.setColor(COLORS.COMPLETE);
      message.channel.send({embed: ee})
    }else{
      if(commands[arg]){
        var ee = new Discord.RichEmbed();
        ee.setTitle(PREFIX + arg + ' Help')
        ee.setDescription(commands[arg].documentation);
        ee.setFooter(`Run ${PREFIX}help [command] to find out more information about each specific command.`)
        ee.addField('Need help with using Discord?', 'This [link](https://support.discordapp.com/hc/en-us/articles/219470277-Getting-Started) may help.')
        ee.setColor(COLORS.COMPLETE);
        message.channel.send({embed: ee})
      }else{
        dError(message, 'This command doesn\'t exist!')
      }
    }
  },
  documentation: 'You are a very sad human being if you don\'t know how to use a help command.'
}
for(var i in commands){
  if(commands[i]){
    if(!commands[i].permissions) commands[i].permissions = ['READ_MESSAGE_HISTORY'];
  }
}


// Web
webClient.engine('html', require('ejs').renderFile);
webClient.set('views', '.');
webClient.use( express.static( "src/public" ) );
webClient.get('/login/', function (req, res) {
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
            request("https://www.khanacademy.org/api/internal/user/discussion/statistics?kaid=" + response.body.kaid, (err, resp, body) => {
              if(typeof body !== 'object') body = JSON.parse(body);
              var totalPoints = Math.round(response.body.points / 2500) + response.body.badgeCounts['0'] * 5 + response.body.badgeCounts['1'] * 10 + response.body.badgeCounts['2'] * 15 + response.body.badgeCounts['3'] * 50 + response.body.badgeCounts['4'] * 100 + response.body.badgeCounts['5'] * 20 + Math.round(response.body.totalSecondsWatched / 1000) + body.answers * 5 + body.projectanswers * 2;
              var rem = new Discord.RichEmbed();
              rem.setTitle(['Heya', 'Hello', 'Hi', 'Sup', 'Welcome'][Math.floor(Math.random()*5)] + ', **' + response.body.studentSummary.nickname.substr(0, 200) + '**!')
              rem.setDescription('You\'re all set up!');
              rem.setFooter('If you would like your account to be private (hidden from other users), run `' + PREFIX + 'toggleAccountPrivate`.')
              rem.addField('Your UKAB Points', totalPoints)
              rem.setColor(COLORS.INFORMATION);
              discordClient.users.get(id).send({embed: rem})
              queryUsers(id, (err, res) => {
                if(err || res.rows.length !== 1){
                  pgSQLClient.query('INSERT INTO users VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)', [id, token, tokenSecret, response.body.username, response.body.studentSummary.nickname, response.body.kaid, new Date().toString(), totalPoints, 0])
                    .then(resd => {
                      console.log('[UKB] Data uploaded!');
                      delete users[i];
                    })
                    .catch(e => console.error(e.stack))
                  pgSQLClient.query('SELECT * FROM servers;', [])
                    .then(resd => {
                      for(var server of resd.rows){
                        if(server.login_mandatory && discordClient.guilds.get(server.id)){
                          var member = discordClient.guilds.get(server.id).members.get(id);
                          if(member){

                            member.addRole(member.guild.roles.find('name', 'Verified'), 'KAID: ' + response.body.kaid);

                            var pv = (+response.body.points >= 1000000 ? (+response.body.points >= 5000000 ? (+response.body.points >= 10000000 ? '10,000,000' : '5,000,000') : '1,000,000') : null) + '+ EPs';
                            member.addRole(member.guild.roles.find('name', pv), 'Has ' + response.body.points + ' energy points.')
                              .catch(console.log)

                            var totalBadges = +response.body.badgeCounts['0'] + +response.body.badgeCounts['1'] + +response.body.badgeCounts['2'] + +response.body.badgeCounts['3'] + +response.body.badgeCounts['4'] + +response.body.badgeCounts['5'];

                            if(totalBadges >= 1000){
                              var tv = (totalBadges >= 5000 ? (totalBadges >= 10000 ? '10' : '5') : '1') + ',000+ Badges';
                              console.log(tv)
                              member.addRole(member.guild.roles.find('name', tv), 'Has ' + totalBadges + ' badges.')
                                .catch(console.log)
                            }
                            console.log(totalBadges)
                            client.auth(token, tokenSecret)
                              .get('/api/internal/user/streak', {casing: 'camel'})
                              .then(stres => {
                                var streakData = stres.body;
                                streakData.history.sort((a, b) => {
                                  return (new Date(a[0]) - new Date(a[1])) - (new Date(b[0]) - new Date(b[1]))
                                })
                                console.log(streakData.history)
                                if(!streakData.history[0]){

                                }else{
                                  var longestStreak = Math.abs(new Date(streakData.history[0][0]) - new Date(streakData.history[0][1]));

                                  longestStreak /= 1000; // ms
                                  longestStreak /= 60; // seconds
                                  longestStreak /= 60; // minutes
                                  longestStreak /= 24; // hours
                                  longestStreak = Math.ceil(longestStreak);

                                  if(longestStreak >= 100){
                                    var lv = (longestStreak >= 500 ? (longestStreak >= 1000 ? '1,000' : '500') : '100') + '+ Day Streak';
                                    console.log(lv);
                                    member.addRole(member.guild.roles.find('name', lv), 'Has ' + longestStreak + ' days as their longest streak..')
                                      .catch(console.log)
                                  }
                                }

                                client.auth(token, tokenSecret)
                                  .get('/api/v1/user/exercises', { casing: 'camel' })
                                  .then(exres => {
                                    var exercises = exres.body;
                                    var masteredExercises = [];
                                    for(var i = 0; i < exercises.length; i++){
                                      if(exercises[i].fpmMasteryLevel === 'mastered'){
                                        masteredExercises.push(exercises[i])
                                      }
                                    }
                                    var mastered = masteredExercises.length;

                                    if(mastered >= 100){
                                      var mv = (mastered >= 500 ? (mastered >= 1000 ? '1,000' : '500') : '100') + '+ Skills';
                                      console.log(mv);
                                      member.addRole(member.guild.roles.find('name', mv), 'Has ' + mastered + ' exercises mastered.')
                                        .catch(console.log)
                                    }
                                    console.log(mastered)
                                  })
                                  .catch(e => {
                                    console.error(e)
                                  })
                              })

                            member.removeRole(member.guild.roles.find('name', 'New'), 'Automatically verified; see KAID above.')
                          }
                        }
                      }
                    })
                }
              })
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
  discordClient.user.setPresence({ game: { name: ('Version ' + version + (DEBUG?'b':'') + " | " + PREFIX + "help") }, status: 'idle' })
  if(!DEBUG){
    interval = setInterval(function(){
      request('http://ukb.herokuapp.com/', (err, res) => {
        var acceptEmbed = new Discord.RichEmbed();
        acceptEmbed.setTitle('Statistics');
        acceptEmbed.setDescription('Number of commands run this cycle: **' + commandsRun + '**');
        commadsRun = 0;
        acceptEmbed.addField('Errors', err ? (err.stack || err) : 'none')
        acceptEmbed.setColor(COLORS.INFORMATION);
        discordClient.channels.get(RELOAD_CHANNEL).send({embed: acceptEmbed});

      })
    }, 1200000)
  }
});
discordClient.on('message', (message) => {
  if(message.guild === null) return;

  pgSQLClient.query('SELECT * FROM servers WHERE id=$1', [message.guild.id])
  .then((res, err) => {
    if(res.rows[0].login_channel === message.channel.id && message.content !== 'ka!login' && message.author.id !== discordClient.user.id && !message.member.permissions.has(['ADMINISTRATOR'])){
      message.delete();
    }
  })

  if(message.content.toLowerCase().startsWith(PREFIX.toLowerCase())){
    var command = message.content.toLowerCase().replace(PREFIX.toLowerCase(), '').split(' ')[0];
    var arg = message.content.substr(command.length + PREFIX.length + 1, message.content.length-1)
    var member = message.guild.members.get(message.author.id);
    if(Object.keys(commands).map(el => el.toLowerCase()).includes(command)){
      var cmd = commands[Object.keys(commands).find(a => a.toLowerCase() === command)]

      if((cmd.users && cmd.users.includes(member.id) && member.permissions.has(cmd.permissions)) || (!cmd.users && member.permissions.has(cmd.permissions))){
        pgSQLClient.query('SELECT * FROM servers WHERE id=$1', [message.guild.id])
        .then((res, err) => {
          if(res.rows[0].login_channel !== message.channel.id || command === 'login' || message.author.id === PING_USER){
            commandsRun++;
            cmd.run(message, arg, member);
          }else{
            dError(message, "Please login before using other commands.")
          }
        })
      }else{
        dError(message, 'You need more permissions to run this command.')
      }
    }else{
      dError(message, 'This command does not exist.')
    }
  }else if(message.mentions.users.get(discordClient.user.id)){
    var fun;
    for(var i in FUN_WORDS){
      if(new RegExp(i, 'g').exec(message.content) && !fun){
        message.channel.send(FUN_WORDS[i]);
        fun = true;
      }
    }
    if(!fun)
      commands.help.run(message, '', message.member);
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
  pgSQLClient.query('INSERT INTO servers VALUES($1, $2, $3, $4)', [guild.id, 0, potentialChannels[0] || '1', '{"threshold": 5}'])
    .then(resd => {
      console.log('[UKB] Data uploaded to servers!');
    })
    .catch(e => console.error(e.stack))
})
discordClient.on('guildMemberAdd', (member) => {
  pgSQLClient.query('SELECT * FROM servers WHERE id=$1;', [member.guild.id])
    .then(res => {
      if(res.rows[0].login_mandatory.toString() === '1'){
        pgSQLClient.query('SELECT * FROM users WHERE id=$1;', [member.id])
          .then(resUSERS => {
            if(!resUSERS.rows[0]){
              var pleaseLogin = new Discord.RichEmbed();
              pleaseLogin.setAuthor(member.guild.name, member.guild.iconURL);
              pleaseLogin.setDescription('Hello, ' + member + '! The administrators of this server have made KA login mandatory for entrance. In order to enter this server, type `' + PREFIX + 'login` and send it in this channel. You will get connection instructions in DM.')
              pleaseLogin.setColor(COLORS.ERROR);
              pleaseLogin.addField('Need help with using Discord?', 'This [link](https://support.discordapp.com/hc/en-us/articles/219470277-Getting-Started) may help.')
              pleaseLogin.setFooter('You cannot join this server if you have a child account, as underage users violate COPPA, which is in effect on discord. We are sorry for any inconvenience.');
              member.guild.channels.get(res.rows[0].login_channel).send({embed: pleaseLogin});
            }else{
              var q = setInterval(function(){
                var verfai = member.guild.roles.find('name', 'Verified');
                var new_ = member.guild.roles.find('name', 'New');
                if(new_){
                  member.addRole(verfai, 'KAID: ' + resUSERS.rows[0].kaid);
                  client.auth(resUSERS.rows[0].token, resUSERS.rows[0].secret)
                    .get("/api/v1/user", { casing: "camel" })
                    .then(response => {
                      if(typeof response.body !== 'object') response.body = JSON.parse(response.body);
                      var pv = (+response.body.points >= 1000000 ? (+response.body.points >= 5000000 ? (+response.body.points >= 10000000 ? '10' : '5') : '1') : null) + ',000,000+ EPs';
                      console.log(pv)
                      member.addRole(member.guild.roles.find('name', pv), 'Has ' + response.body.points + ' energy points.')
                        .catch(console.log)

                      var totalBadges = +response.body.badgeCounts['0'] + +response.body.badgeCounts['1'] + +response.body.badgeCounts['2'] + +response.body.badgeCounts['3'] + +response.body.badgeCounts['4'] + +response.body.badgeCounts['5'];

                      if(totalBadges >= 1000){
                        var tv = (totalBadges >= 5000 ? (totalBadges >= 10000 ? '10' : '5') : '1') + ',000+ Badges';
                        console.log(tv)
                        member.addRole(member.guild.roles.find('name', tv), 'Has ' + totalBadges + ' badges.')
                          .catch(console.log)
                      }
                      console.log(totalBadges)
                      client.auth(resUSERS.rows[0].token, resUSERS.rows[0].secret)
                        .get('/api/internal/user/streak', {casing: 'camel'})
                        .then(stres => {
                          var streakData = stres.body;
                          streakData.history.sort((a, b) => {
                            return (new Date(a[0]) - new Date(a[1])) - (new Date(b[0]) - new Date(b[1]))
                          })
                          console.log(streakData.history)
                          if(!streakData.history[0]){

                          }else{
                            var longestStreak = Math.abs(new Date(streakData.history[0][0]) - new Date(streakData.history[0][1]));

                            longestStreak /= 1000; // ms
                            longestStreak /= 60; // seconds
                            longestStreak /= 60; // minutes
                            longestStreak /= 24; // hours
                            longestStreak = Math.ceil(longestStreak);

                            if(longestStreak >= 100){
                              var lv = (longestStreak >= 500 ? (longestStreak >= 1000 ? '1,000' : '500') : '100') + '+ Day Streak';
                              console.log(lv);
                              member.addRole(member.guild.roles.find('name', lv), 'Has ' + longestStreak + ' days as their longest streak..')
                                .catch(console.log)
                            }
                          }

                          client.auth(resUSERS.rows[0].token, resUSERS.rows[0].secret)
                            .get('/api/v1/user/exercises', { casing: 'camel' })
                            .then(exres => {
                              var exercises = exres.body;
                              var masteredExercises = [];
                              for(var i = 0; i < exercises.length; i++){
                                if(exercises[i].fpmMasteryLevel === 'mastered'){
                                  masteredExercises.push(exercises[i])
                                }
                              }
                              var mastered = masteredExercises.length;

                              if(mastered >= 100){
                                var mv = (mastered >= 500 ? (mastered >= 1000 ? '1,000' : '500') : '100') + '+ Skills';
                                console.log(mv);
                                member.addRole(member.guild.roles.find('name', mv), 'Has ' + mastered + ' exercises mastered.')
                                  .catch(console.log)
                              }
                              console.log(mastered)
                            })
                            .catch(e => {
                              console.error(e)
                            })
                        })
                    })

                  if(member.roles.exists('name', 'New')){
                    console.log('has new person role')
                    member.removeRole(new_, 'Automatically verified; see KAID above.')
                    clearInterval(q);
                  }
                }
              }, 100)

            }
          })
      }
    })
})

discordClient.on('messageReactionAdd', (reaction, user) => {
  if(reaction.message.guild === null) return;

  if(reaction.emoji.name === '\u2B50'){
    var stars = reaction.message.reactions.get('\u2B50');
    pgSQLClient.query("SELECT * FROM servers WHERE id=$1", [reaction.message.guild.id])
      .then(resulting => {
        var thr = JSON.parse(resulting.rows[0].starboard_config)

        if(reaction.message.author.id === user.id && thr.channel){
          reaction.remove(user)
            .catch(console.log)
          user.send('You can\'t star your own messages!')
            .catch(e => {
              reaction.message.channel.send('You can\'t star your own messages!');
            })
        }else{
          if(stars.count >= +thr.threshold && reaction.message.author.id !== discordClient.user.id && thr.channel){
            discordClient.channels.get(thr.channel).fetchMessages({limit: 50})
              .then(messages => {
                for(var m of messages){
                  if(m[1].author.id === discordClient.user.id && m[1].embeds[0].footer.text.split('•')[2] && m[1].embeds[0].footer.text.split('•')[2].trim().replace('ID: ', '') === reaction.message.id){
                    m[1].delete();
                  }
                }
              })
            reaction.message.react('\uD83C\uDF1F');
            var starEmbed = new Discord.RichEmbed();
            starEmbed.setAuthor(reaction.message.author.username, reaction.message.author.avatarURL);
            starEmbed.setDescription(reaction.message.content !== '' ? reaction.message.content : reaction.message.embeds[0].description);
            if(reaction.message.attachments.array()[0]){
              starEmbed.setImage(reaction.message.attachments.array()[0].proxyURL)
            }
            starEmbed.setColor(COLORS.INFORMATION);
            starEmbed.setFooter(stars.count + " \u2B50 • Updated " + new Date() + " • ID: " + reaction.message.id)
            discordClient.channels.get(thr.channel).send({embed: starEmbed})
              .catch(console.error)
          }
        }
      })
  }
})

// Process handlers @TODO make less ugly
process.on('SIGINT', handleShutdown.bind(null, 'SIGINT (CONTROL+C MANUAL CLOSE)'));
process.on('SIGTERM', handleShutdown.bind(null, 'SIGTERM (HEROKU GIT CONTROL)'));
process.on('SIGUSR1', handleShutdown.bind(null, 'SIGUSR1'));
process.on('SIGUSR2', handleShutdown.bind(null, 'SIGUSR2 (NODEMON RS)', undefined, true));
process.on('error', (err) => {
  console.log('QASD' + Object.keys(err));
  handleShutdown('ERROR (MISC)', err)
})

process.on('uncaughtException', (err) => {
  for(var i in err){
    console.log(i);
  }
  console.error(err)
  handleShutdown('ERROR (RUNTIME)', err)
});
process.on('unhandledRejection', (res, err) => {
  console.log(res, err)
  handleShutdown('ERROR (PROMISE)', res)
});
