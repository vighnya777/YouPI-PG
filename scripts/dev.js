import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../packages/db/src/migrate.js';
import { startControlCenter } from '../apps/control-center/src/index.js';
import { startCloudflaredSafely } from '../packages/common/src/tunnel-command.js';
import { resolveRuntimeUrls } from '../packages/common/src/runtime-config.js';
import { resolvePublicGatewayPorts, startPublicGateway } from '../apps/public-gateway/src/server.js';
import { getAdminToken } from '../packages/common/src/secrets.js';
import { isHostedDeployment } from './deployment-context.js';

if (!process.env.YOUPI_MODE) process.env.YOUPI_MODE = 'localhost';
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const { publicPort, helpPort } = resolvePublicGatewayPorts();
const controlCenterPort = Number(process.env.CONTROL_CENTER_PORT || 8090);
const apiPort = Number(process.env.PAYMENT_API_PORT || 6100);
process.env.HELP_PORTAL_PORT = String(helpPort);
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${publicPort}`;

const runtimeUrls = resolveRuntimeUrls({
  envMode: 'localhost',
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  publicRouterPort: publicPort
});
process.env.BASE_PAYMENT_API_URL = runtimeUrls.apiUrl;
process.env.BASE_CHECKOUT_URL = runtimeUrls.checkoutUrl;
process.env.BASE_ADMIN_URL = runtimeUrls.adminUrl;
process.env.BASE_HELP_URL = runtimeUrls.helpUrl;
process.env.BASE_DEMO_STORE_URL = runtimeUrls.storeUrl;
process.env.GMAIL_REDIRECT_URI = runtimeUrls.gmailRedirectUri;
process.env.PAYMENT_API_INTERNAL_URL = `http://127.0.0.1:${apiPort}`;

console.log('====================================================');
console.log('🚀 Starting YOUPI PG (Development / Single-Origin Mode)');
console.log('====================================================');

// 1. Run database migrations & seeds
console.log('[1/2] Checking and applying database migrations...');
const migrationResult = runMigrations();
console.log(`[✓] Database ready. Default merchant: ${migrationResult.defaultMerchant.businessName}`);

// Check for user-configured Cloudflare Tunnel command
let tunnelProcess = null;
const branding = migrationResult.defaultMerchant?.branding || {};
const tunnelCmd = process.env.CLOUDFLARE_TUNNEL_COMMAND || branding.cloudflareTunnelCommand;

if (tunnelCmd && tunnelCmd.trim()) {
  console.log(`\n[☁️ Cloudflare Tunnel] Executing tunnel command before starting services:`);
  tunnelProcess = startCloudflaredSafely(tunnelCmd, { stdio: 'inherit' });
  if (tunnelProcess) console.log(`[✓] Cloudflare Tunnel process launched (PID: ${tunnelProcess.pid}).\n`);
  // Brief pause to establish socket before services spin up
  await new Promise(r => setTimeout(r, 1500));
}

// 2. Start Control Center supervisor and launch all services
console.log(`[2/2] Launching Local Process Control Center on port ${controlCenterPort}...`);
const cc = await startControlCenter(controlCenterPort);

console.log(`\n[✓] Local process supervisor is online on port ${controlCenterPort}`);
console.log('[*] Starting all modular gateway services...\n');

await cc.processManager.startAll();
const publicGateway = await startPublicGateway(publicPort);

console.log('====================================================');
console.log('🟢 YOUPI PUBLIC GATEWAY ONLINE');
console.log('====================================================');
console.log(`• Public origin:        ${runtimeUrls.publicUrl}`);
console.log(`• Merchant Admin:       ${runtimeUrls.adminUrl}`);
if (isHostedDeployment()) {
  console.log(`• Admin API token:      ${getAdminToken()}`);
  console.log('  Restrict hosting log access to administrators.');
}
console.log(`• Payment API:          ${runtimeUrls.apiUrl}/api`);
console.log(`• Checkout:             ${runtimeUrls.checkoutUrl}/checkout/:id`);
console.log(`• Demo Store:           ${runtimeUrls.storeUrl}`);
console.log(`• Help:                 ${runtimeUrls.helpUrl}`);
console.log(`• Gmail OAuth callback: ${runtimeUrls.gmailRedirectUri}`);
console.log(`• Local supervisor:    http://localhost:${controlCenterPort} (not public)`);
console.log('====================================================');
console.log('Press Ctrl+C to stop all services gracefully.');

// Handle graceful shutdown
const shutdown = async () => {
  console.log('\nStopping all services gracefully...');
  if (tunnelProcess && tunnelProcess.pid) {
    try {
      console.log('Terminating Cloudflare Tunnel process...');
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(tunnelProcess.pid), '/f', '/t']);
      } else {
        tunnelProcess.kill('SIGTERM');
      }
    } catch {}
  }
  await publicGateway.close();
  await cc.close();
  console.log('All processes terminated cleanly.');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
