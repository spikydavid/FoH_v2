const path = require('path');
const dotenv = require('dotenv');
const packageJson = require('../../package.json');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const port = Number(process.env.PORT || 3000);

module.exports = {
  appName: packageJson.name,
  appVersion: packageJson.version,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number.isNaN(port) ? 3000 : port,
};
