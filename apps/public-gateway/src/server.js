import http from 'node:http';

const DEFAULT_PORTS = Object.freeze({
  api: Number(process.env.PAYMENT_API_PORT || 6100),
  checkout: Number(process.env.CHECKOUT_PORTAL_PORT || 7000),
  admin: Number(process.env.MERCHANT_ADMIN_PORT || 6001),
  gmail: Number(process.env.GMAIL_OBSERVER_PORT || 6003),
  store: Number(process.env.COIN_WALLET_STORE_PORT || 5000)
});

const STORE_ROOT_ROUTES = new Set([
  '/wallet',
  '/success',
  '/failed',
  '/suspicious',
  '/expired',
  '/cancelled',
  '/order-success',
  '/order-failed',
  '/order-suspicious',
  '/order-expired',
  '/order-cancelled',
  '/assets',
  '/openapi.yaml'
]);

const STORE_API_ROUTES = new Set([
  '/api/wallet-balance',
  '/api/payment-notification',
  '/api/checkout',
  '/api/verify-payment',
  '/api/webhook'
]);

export function resolvePublicGatewayPorts(env = process.env) {
  const publicPort = Number(env.PORT || env.PUBLIC_ROUTER_PORT || 8080);
  const configuredHelpPort = Number(env.HELP_PORTAL_PORT || 3000);
  return {
    publicPort,
    helpPort: configuredHelpPort === publicPort ? publicPort + 1 : configuredHelpPort
  };
}

function routeRequest(pathname, ports) {
  if (pathname === '/health') return { service: null };

  if (pathname === '/' || pathname === '/admin' || pathname.startsWith('/admin/')) {
    const path = pathname === '/' || pathname === '/admin' ? '/' : pathname.slice('/admin'.length);
    return { service: 'admin', port: ports.admin, path };
  }

  if (pathname === '/api/services' || pathname.startsWith('/api/services/') ||
      pathname === '/api/logs/stream' || pathname === '/api/admin/tickets' ||
      pathname === '/api/v1/admin/sms-gateway/download-apk' ||
      pathname === '/youpi-sms-gateway.apk') {
    return { service: 'admin', port: ports.admin };
  }
  if (STORE_API_ROUTES.has(pathname)) return { service: 'store', port: ports.store };
  if (pathname.startsWith('/api/')) return { service: 'api', port: ports.api };
  if (pathname === '/oauth' || pathname.startsWith('/oauth/')) return { service: 'gmail', port: ports.gmail };

  if (pathname === '/checkout' || pathname.startsWith('/checkout/') ||
      pathname === '/youpi.js' || pathname === '/sdk' || pathname.startsWith('/sdk/') ||
      pathname === '/icons' || pathname.startsWith('/icons/')) {
    return { service: 'checkout', port: ports.checkout };
  }

  if (pathname === '/store' || pathname.startsWith('/store/')) {
    const path = pathname === '/store' || pathname === '/store/' ? '/' : pathname.slice('/store'.length);
    return { service: 'store', port: ports.store, path };
  }
  if ([...STORE_ROOT_ROUTES].some(route => pathname === route || pathname.startsWith(`${route}/`)) ||
      pathname.startsWith('/order-')) {
    return { service: 'store', port: ports.store };
  }
  if (pathname === '/help' || pathname.startsWith('/help/') || pathname === '/support') {
    const path = pathname === '/help' ? '/help' : pathname.startsWith('/help/') ? pathname.slice('/help'.length) : pathname;
    return { service: 'help', port: ports.help, path };
  }

  return null;
}

export class PublicGatewayServer {
  constructor(options = {}) {
    this.ports = { ...DEFAULT_PORTS, ...(options.ports || {}) };
    this.helpPort = options.helpPort || Number(process.env.HELP_PORTAL_PORT || 3000);
  }

  createServer() {
    return http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const route = routeRequest(url.pathname, { ...this.ports, help: this.helpPort });

      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Public route not found' }));
        return;
      }

      if (!route.service) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'UP', service: 'public-gateway' }));
        return;
      }

      const targetPath = route.path === undefined
        ? req.url
        : `${route.path}${url.search}`;
      const headers = {
        ...req.headers,
        host: `127.0.0.1:${route.port}`,
        'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host || '',
        'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'http'
      };

      const proxyRequest = http.request({
        hostname: '127.0.0.1',
        port: route.port,
        path: targetPath,
        method: req.method,
        headers
      }, proxyResponse => {
        res.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
        proxyResponse.pipe(res);
      });

      proxyRequest.on('error', error => {
        if (res.headersSent) {
          res.destroy(error);
          return;
        }
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          error: `${route.service} service is unavailable`,
          details: error.message
        }));
      });

      res.on('close', () => {
        if (!res.writableEnded) proxyRequest.destroy();
      });
      req.pipe(proxyRequest);
    });
  }
}

export function startPublicGateway(port = null, options = {}) {
  const finalPort = port || resolvePublicGatewayPorts().publicPort;
  const server = new PublicGatewayServer(options).createServer();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(finalPort, () => {
      server.removeListener('error', reject);
      console.log(`[Public Gateway] Listening on port ${finalPort}`);
      resolve({
        port: finalPort,
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done()))
      });
    });
  });
}
