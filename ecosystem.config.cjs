const os = require("os");
const path = require("path");

const HOME = process.env.HERMES_HOME || os.homedir();
const DATA_DIR = process.env.WEIXIN_DATA_DIR || path.join(HOME, "components/weixin");
const SKILL_DIR = process.env.WEIXIN_SKILL_DIR || path.join(HOME, "skills/hermes-weixin");

module.exports = {
  apps: [
    {
      name: "hermes-weixin",
      script: "dist/bot.js",
      cwd: SKILL_DIR,
      interpreter: "node",
      node_args: "",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      env: {
        NODE_ENV: "production",
        HERMES_HOME: HOME,
        WEIXIN_DATA_DIR: DATA_DIR,
      },
      error_file: path.join(DATA_DIR, "logs/error.log"),
      out_file: path.join(DATA_DIR, "logs/out.log"),
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
