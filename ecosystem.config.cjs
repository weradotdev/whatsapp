/**
 * PM2 ecosystem config. Start from project root: pm2 start ecosystem.config.cjs
 * Loads WhatsApp-related env from root .env when present.
 */
const path = require('path');
const fs = require('fs');

function loadEnvFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const env = {};
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    });
    return env;
  } catch {
    return {};
  }
}

const rootDir = __dirname;
const envFromRoot = loadEnvFromFile(path.join(rootDir, '.env'));

const whatsappEnv = {
  PORT: envFromRoot.WHATSAPP_SERVICE_PORT || envFromRoot.PORT || '3000',
  APP_URL: envFromRoot.APP_URL || 'http://localhost:8000',
  WHATSAPP_CALLBACK_TOKEN: envFromRoot.WHATSAPP_CALLBACK_TOKEN || '',
};

module.exports = {
  apps: [
    {
      name: 'wera-whatsapp',
      script: 'server.js',
      cwd: path.join(rootDir, 'services/whatsapp'),
      interpreter: 'node',
      env: whatsappEnv,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
