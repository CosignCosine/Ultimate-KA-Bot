# Ultimate KA Bot

## Setup Instructions

- Install the latest version of [node and npm](https://nodejs.org/en/download/).
- Clone the repository on the desktop using whatever means preferable.

  - `git clone https://github.com/CosignCosine/Ultimate-KA-Bot.git`

    - This is the preferred option, as it makes updates very easy.

  - Download > Open in Desktop

  - Download > Download ZIP

- Run `npm install` and the necessary packages will be installed.

- In order to view the database, you may need to install Postgres. My preferred methods are below:

  - [Mac](https://postgresapp.com/)
  - [Windows](http://www.postgresqltutorial.com/install-postgresql/)

- Set the environment variables:

  - `TOKEN`: The discord bot's token.
  - `KEY`: The KA authorization's consumer key.
  - `SECRET`: The KA authorization's consumer secret.
  - `PORT`: The port this application will run its webserver off. The default is '80'.
  - `DATABASE_URL`: The database's total URL. It should look something like `postgres://blahblahblah:blahblahblah@example.com:1234/blahblahblah`

- Run the bot initialization script: `node src/js/index.js`

- Note: if you are running the bot on the default port/80, you will need to run `sudo node src/js/index.js`

- Profit???
