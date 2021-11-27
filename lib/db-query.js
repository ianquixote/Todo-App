const config = require("./config");
const { Client } = require('pg');

const logQuery = (statement, parameters) =>  {
  let timestamp = new Date();
  let formattedTimestamp = timestamp.toString().substring(4, 24);
  console.log(formattedTimestamp, statement, parameters);
};

const isProduction = (config.NODE_ENV === "production"); //Should evaluate to true with the config.NODE_ENV environment variable provided by Heroku
const CONNECTION = {
  connectionString: config.DATABASE_URL,
  //ssl: isProduction; //
  ssl: { rejectUnauthorized: false },
};

module.exports = {
  async dbQuery(statement, ...parameters) {
    //let client = new Client({ database: "todo-lists"});
    let client = new Client(CONNECTION);

    await client.connect();
    logQuery(statement, parameters);
    let result = await client.query(statement, parameters);
    await client.end();

    return result;
  }
};
