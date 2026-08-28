const path = require("path");

const name = "@nana/site";
const logBase = name.replace("/", "-");

module.exports = {
  apps: [
    {
      name,
      cwd: __dirname,
      script: path.join(__dirname, ".output/server/index.mjs"),
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      time: true,
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 5000,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "6364",
        HOST: "0.0.0.0",
      },
      error_file: path.join(__dirname, `pm2-${logBase}.err.log`),
      out_file: path.join(__dirname, `pm2-${logBase}.out.log`),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
