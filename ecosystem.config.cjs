const bot = require("./apps/bot/ecosystem.config.cjs");
const site = require("./apps/site/ecosystem.config.cjs");

module.exports = {
  apps: [...bot.apps, ...site.apps],
};
