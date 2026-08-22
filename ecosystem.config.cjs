const bot = require("./apps/bot/ecosystem.config.cjs");

module.exports = {
  apps: [...bot.apps],
};
