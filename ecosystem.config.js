const bot = require("./apps/bot/ecosystem.config.js");

module.exports = {
  apps: [...bot.apps],
};
