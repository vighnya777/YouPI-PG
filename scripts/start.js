import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runMigrations } from '../packages/db/src/migrate.js';
import { startControlCenter } from '../apps/control-center/src/index.js';
import { resolveRuntimeUrls } from '../packages/common/src/runtime-config.js';
import { startCloudflaredSafely } from '../packages/common/src/tunnel-command.js';
import { resolvePublicGatewayPorts, startPublicGateway } from '../apps/public-gateway/src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Authoritative runtime mode enforcement (Part B1 & B4)
process.env.YOUPI_MODE = 'production';
process.env.NODE_ENV = 'production';

// In production, reliably ensure environment variables from .env are loaded
try {
  const rootEnv = path.resolve(rootDir, '.env');
  if (fs.existsSync(rootEnv) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(rootEnv);
  }
} catch {}

console.log('====================================================');
console.log('🚀 Starting YOUPI PG V2 — Production Gateway');
console.log('====================================================');

// 1. Run database migrations & load persisted configuration (Part B3: never overwrite settings)
console.log('[1/3] Loading persisted production database & settings...');
const migrationResult = runMigrations();
const merchant = migrationResult.defaultMerchant;
const branding = merchant?.branding || {};

// 2. Validate Production Configuration (Part B2 & Part I)
const domain = (branding.cloudflareDomain || branding.domainTld || process.env.CLOUDFLARE_DOMAIN || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const prefix = (branding.deploymentPrefix || branding.domainPrefix || process.env.DEPLOYMENT_PREFIX || 'pay').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '') || 'pay';
const { publicPort: routerPort, helpPort } = resolvePublicGatewayPorts();
process.env.HELP_PORTAL_PORT = String(helpPort);

let runtimeUrls;
try {
  runtimeUrls = resolveRuntimeUrls({
    envMode: 'production',
    domain,
    prefix,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    publicRouterPort: routerPort
  });
} catch (err) {
  console.error('\n❌ [CONFIGURATION ERROR]:', err.message);
  process.exit(1);
}

process.env.PUBLIC_BASE_URL = runtimeUrls.publicUrl;
process.env.PUBLIC_ROUTER_PORT = String(routerPort);
process.env.PAYMENT_API_INTERNAL_URL = `http://127.0.0.1:${process.env.PAYMENT_API_PORT || 6100}`;
process.env.BASE_PAYMENT_API_URL = runtimeUrls.apiUrl;
process.env.BASE_CHECKOUT_URL = runtimeUrls.checkoutUrl;
process.env.BASE_ADMIN_URL = runtimeUrls.adminUrl;
process.env.BASE_HELP_URL = runtimeUrls.helpUrl;
process.env.BASE_DEMO_STORE_URL = runtimeUrls.storeUrl;
process.env.GMAIL_REDIRECT_URI = runtimeUrls.gmailRedirectUri;

console.log(`[✓] Authoritative Runtime Mode: PRODUCTION`);
console.log(`[✓] Single public origin: ${runtimeUrls.publicUrl}`);
console.log(`[✓] Deployment Prefix: ${runtimeUrls.prefix}`);
console.log('[✓] Public path routes: /api, /checkout, /admin, /help, /store, /oauth\n');

// Check for user-configured Cloudflare Tunnel command
let tunnelProcess = null;
const tunnelCmd = process.env.CLOUDFLARE_TUNNEL_COMMAND || branding.cloudflareTunnelCommand;

if (tunnelCmd && tunnelCmd.trim()) {
  console.log(`[☁️ Cloudflare Tunnel] Executing tunnel command before starting services:`);
  tunnelProcess = startCloudflaredSafely(tunnelCmd, { stdio: 'inherit' });
  if (tunnelProcess) console.log(`[✓] Cloudflare Tunnel process launched (PID: ${tunnelProcess.pid}).\n`);
  await new Promise(r => setTimeout(r, 1500));
}

// 3. Launch Process Supervisor and Production Services
console.log('[2/3] Launching Local Process Supervisor on port 8090...');
const cc = await startControlCenter(8090);

console.log('[3/3] Starting core production gateway services (Pure API & Android Observer)...\n');
await cc.processManager.startAll();

const publicGateway = await startPublicGateway(routerPort);

console.log('====================================================');
console.log('🟢 YOUPI PG V2 PRODUCTION GATEWAY ONLINE & ACTIVE');
console.log('====================================================');
console.log('SINGLE PUBLIC ORIGIN & PATH ROUTES:');
console.log(`• Merchant Admin Hub:   ${runtimeUrls.publicUrl}/admin`);
console.log(`• Payment API:          ${runtimeUrls.publicUrl}/api`);
console.log(`• Checkout Portal:      ${runtimeUrls.publicUrl}/checkout`);
console.log(`• Payment Help:         ${runtimeUrls.helpUrl}`);
console.log(`• Demo Store (Opt):     ${runtimeUrls.storeUrl}`);
console.log(`• Gmail OAuth Callback: ${runtimeUrls.gmailRedirectUri}`);
console.log(`• Public Gateway Port:  ${publicGateway.port}`);
console.log('----------------------------------------------------');
console.log('OBSERVATION CHANNELS:');
console.log('• Android SMS Observer: Native APK -> Public Payment API');
console.log('• Gmail API Observer:   OAuth2 API -> Public Payment API');
console.log('• Legacy Chrome CDP:    DISABLED in production');
console.log('====================================================');
console.log('Press Ctrl+C to stop all services gracefully.');

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
