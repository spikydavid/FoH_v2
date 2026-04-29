const env = require('../config/env');

function getInfo(_req, res) {
  res.json({
    name: env.appName,
    version: env.appVersion,
    nodeEnv: env.nodeEnv,
    port: env.port,
    uptimeSeconds: Math.floor(process.uptime()),
  });
}

module.exports = {
  getInfo,
};
