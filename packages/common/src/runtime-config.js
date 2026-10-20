/**
 * Canonical Cloudflare Tunnel and Runtime URL Resolution Engine.
 * Single source of truth for runtime mode, derived hostnames, and service mappings.
 */

export const SERVICE_PORTS = Object.freeze({
  CHECKOUT: 7000,
  API: 6100,
  ADMIN: 6001,
  GMAIL: 6003,
  STORE: 5000,
  PUBLIC_GATEWAY: Number(process.env.PUBLIC_ROUTER_PORT || 8080)
});

function normalizePublicBaseUrl(value) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('PUBLIC_BASE_URL must be an http(s) origin without a path, query, or credentials.');
  }
  return parsed.origin;
}

/**
 * Derives the single public hostname and its local reverse-proxy target.
 * @param {{ domain?: string, prefix?: string, publicBaseUrl?: string, publicRouterPort?: number }} config
 * @returns {Array<{
 *   role: string,
 *   name: string,
 *   publicHostname: string,
 *   publicUrl: string,
 *   serviceUrl: string,
 *   port: number,
 *   purpose: string,
 *   optional: boolean
 * }>}
 */
export function deriveCloudflareRoutes(config = {}) {
  const rawDomain = (config.domain || config.domainTld || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const rawPrefix = (config.prefix || config.domainPrefix || 'pay').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '') || 'pay';
  const publicBaseUrl = config.publicBaseUrl || process.env.PUBLIC_BASE_URL;
  if (!rawDomain && !publicBaseUrl) {
    return [];
  }

  const publicUrl = publicBaseUrl
    ? normalizePublicBaseUrl(publicBaseUrl)
    : `https://${rawPrefix}.${rawDomain}`;
  const publicHostname = new URL(publicUrl).host;
  const publicRouterPort = Number(config.publicRouterPort || process.env.PUBLIC_ROUTER_PORT || SERVICE_PORTS.PUBLIC_GATEWAY);

  return [
    {
      role: 'public-gateway',
      name: 'YOUPI PG Public Gateway',
      publicHostname,
      publicUrl,
      serviceUrl: `http://localhost:${publicRouterPort}`,
      port: publicRouterPort,
      purpose: 'Single public origin; routes API, checkout, admin, help, store, and Gmail OAuth by path.',
      paths: [
        '/',
        '/admin/*',
        '/api/*',
        '/checkout/*',
        '/youpi.js',
        '/sdk/*',
        '/icons/*',
        '/help/*',
        '/support',
        '/store/*',
        '/oauth/*'
      ],
      optional: false
    }
  ];
}

/**
 * Resolves authoritative runtime URLs for all system components.
 * @param {{
 *   envMode?: string,
 *   domain?: string,
 *   domainTld?: string,
 *   prefix?: string,
 *   domainPrefix?: string,
 *   publicBaseUrl?: string,
 *   publicRouterPort?: number
 * }} options
 */
export function resolveRuntimeUrls(options = {}) {
  let mode = options.envMode;
  if (!mode) {
    if (process.env.YOUPI_MODE) {
      mode = process.env.YOUPI_MODE;
    } else if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      mode = 'localhost';
    } else if (process.env.CLOUDFLARE_DOMAIN) {
      mode = 'production';
    } else {
      mode = 'localhost';
    }
  }
  mode = String(mode).toLowerCase();
  const domain = (options.domain || options.domainTld || process.env.CLOUDFLARE_DOMAIN || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const prefix = (options.prefix || options.domainPrefix || process.env.DEPLOYMENT_PREFIX || 'pay').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '') || 'pay';
  const configuredPublicBaseUrl = options.publicBaseUrl || process.env.PUBLIC_BASE_URL || '';

  if (mode === 'production') {
    if (!domain && !configuredPublicBaseUrl) {
      if ((process.env.NODE_ENV === 'test' || process.env.YOUPI_MODE === 'localhost') && options.envMode !== 'production') {
        mode = 'localhost';
      } else {
        throw new Error('Production Configuration Incomplete: set PUBLIC_BASE_URL or CLOUDFLARE_DOMAIN.');
      }
    }
  }

  if (mode === 'production' || configuredPublicBaseUrl) {
    const publicUrl = configuredPublicBaseUrl
      ? normalizePublicBaseUrl(configuredPublicBaseUrl)
      : `https://${prefix}.${domain}`;
    const publicHostname = new URL(publicUrl).host;
    const routes = deriveCloudflareRoutes({
      domain,
      prefix,
      publicBaseUrl: publicUrl,
      publicRouterPort: options.publicRouterPort
    });
    const path = (suffix) => `${publicUrl}${suffix}`;

    return {
      mode,
      isProduction: mode === 'production',
      domain,
      prefix,
      publicUrl,
      publicHostname,
      routes,
      checkoutUrl: publicUrl,
      checkoutHostname: publicHostname,
      apiUrl: publicUrl,
      apiHostname: publicHostname,
      adminUrl: path('/admin'),
      adminHostname: publicHostname,
      gmailUrl: publicUrl,
      gmailHostname: publicHostname,
      gmailRedirectUri: path('/oauth/callback'),
      helpUrl: path('/help'),
      storeUrl: path('/store'),
      storeHostname: publicHostname
    };
  }

  // Localhost / Development Mode
  return {
    mode: 'localhost',
    isProduction: false,
    domain: domain || 'localhost',
    prefix: prefix || 'pay',
    routes: [
      { role: 'checkout', name: 'Checkout', publicHostname: 'localhost:7000', publicUrl: 'http://localhost:7000', serviceUrl: 'http://localhost:7000', port: 7000, purpose: 'Customer checkout / checkout portal', optional: false },
      { role: 'api', name: 'Payment API', publicHostname: 'localhost:6100', publicUrl: 'http://localhost:6100', serviceUrl: 'http://localhost:6100', port: 6100, purpose: 'Payment API / merchant API / SSE / observer ingestion', optional: false },
      { role: 'admin', name: 'Merchant Admin', publicHostname: 'localhost:6001', publicUrl: 'http://localhost:6001', serviceUrl: 'http://localhost:6001', port: 6001, purpose: 'Merchant/Admin panel', optional: false },
      { role: 'gmail', name: 'Gmail OAuth / Gmail Observer', publicHostname: 'localhost:6003', publicUrl: 'http://localhost:6003', serviceUrl: 'http://localhost:6003', port: 6003, purpose: 'Gmail OAuth callback and Gmail observation service', optional: false },
      { role: 'store', name: 'Demo Store', publicHostname: 'localhost:5000', publicUrl: 'http://localhost:5000', serviceUrl: 'http://localhost:5000', port: 5000, purpose: 'Reference/demo store', optional: true }
    ],
    checkoutUrl: 'http://localhost:7000',
    checkoutHostname: 'localhost:7000',
    apiUrl: 'http://localhost:6100',
    apiHostname: 'localhost:6100',
    adminUrl: 'http://localhost:6001',
    adminHostname: 'localhost:6001',
    gmailUrl: 'http://localhost:6003',
    gmailHostname: 'localhost:6003',
    gmailRedirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:6003/oauth/callback',
    helpUrl: process.env.BASE_HELP_URL || 'http://localhost:3000',
    storeUrl: 'http://localhost:5000',
    storeHostname: 'localhost:5000'
  };
}

/**
 * Generates structured SMS Gateway QR pairing payload according to Part C1 & C2.
 */
export function createPairingPayload(options = {}) {
  const {
    serverUrl,
    sessionId = `pair_sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    token = `tok_${Math.random().toString(36).substring(2, 12)}`,
    merchantId = '00000000-0000-0000-0000-000000000001',
    ttlMs = 10 * 60 * 1000 // 10 minutes default
  } = options;

  return {
    version: 'v1',
    type: 'YOUPI_SMS_GATEWAY_PAIR',
    serverUrl: serverUrl || 'http://localhost:6100',
    sessionId,
    token,
    merchantId,
    expiresAt: Date.now() + ttlMs,
    issuedAt: Date.now()
  };
}

/**
 * Validates pairing payload according to Part C5.
 */
export function validatePairingPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'INVALID YOUPI PAIRING QR' };
  }
  if (payload.type !== 'YOUPI_SMS_GATEWAY_PAIR') {
    return { valid: false, error: 'INVALID YOUPI PAIRING QR' };
  }
  if (payload.version !== 'v1') {
    return { valid: false, error: 'INVALID YOUPI PAIRING QR VERSION' };
  }
  if (!payload.serverUrl || !payload.token || !payload.sessionId) {
    return { valid: false, error: 'MALFORMED YOUPI PAIRING QR: Missing required fields' };
  }
  if (!payload.serverUrl.startsWith('http://') && !payload.serverUrl.startsWith('https://')) {
    return { valid: false, error: 'INVALID SERVER URL PROTOCOL' };
  }
  if (payload.expiresAt && Date.now() > payload.expiresAt) {
    return { valid: false, error: 'PAIRING QR EXPIRED' };
  }
  return { valid: true };
}

/**
 * Resolves active runtime pairing API URL.
 */
export function resolvePairingUrl(options = {}) {
  const urls = resolveRuntimeUrls(options);
  return urls.apiUrl || 'http://localhost:6100';
}

/**
 * OAuth redirect URI for the Gmail observer. A shared public origin always uses its routed callback.
 * @param {object} [branding]
 */
export function resolveGmailRedirectUri(branding = {}) {
  if (process.env.PUBLIC_BASE_URL) {
    return `${normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL)}/oauth/callback`;
  }
  if (process.env.GMAIL_REDIRECT_URI) return process.env.GMAIL_REDIRECT_URI;
  try {
    return resolveRuntimeUrls(branding || {}).gmailRedirectUri;
  } catch {
    return `http://localhost:${process.env.GMAIL_OBSERVER_PORT || 6003}/oauth/callback`;
  }
}
