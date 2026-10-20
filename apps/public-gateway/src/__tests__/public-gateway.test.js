import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PublicGatewayServer, resolvePublicGatewayPorts } from '../server.js';

describe('Public gateway path routing', () => {
  test('uses the host-assigned public port and avoids colliding with Help', () => {
    assert.deepEqual(resolvePublicGatewayPorts({
      PORT: '3000',
      PUBLIC_ROUTER_PORT: '8080',
      HELP_PORTAL_PORT: '3000'
    }), {
      publicPort: 3000,
      helpPort: 3001
    });

    assert.deepEqual(resolvePublicGatewayPorts({
      PORT: '10000',
      PUBLIC_ROUTER_PORT: '8080',
      HELP_PORTAL_PORT: '3000'
    }), {
      publicPort: 10000,
      helpPort: 3000
    });
  });

  const upstreams = [];
  const ports = {};
  let gateway;
  let gatewayUrl;

  before(async () => {
    for (const service of ['api', 'checkout', 'admin', 'gmail', 'store']) {
      const upstream = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ service, path: req.url, method: req.method, body }));
        });
      });
      await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
      ports[service] = upstream.address().port;
      upstreams.push(upstream);
    }
    const help = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: 'help', path: req.url }));
    });
    await new Promise(resolve => help.listen(0, '127.0.0.1', resolve));
    ports.help = help.address().port;
    upstreams.push(help);

    const gatewayServer = new PublicGatewayServer({ ports, helpPort: ports.help }).createServer();
    await new Promise(resolve => gatewayServer.listen(0, '127.0.0.1', resolve));
    gatewayUrl = `http://127.0.0.1:${gatewayServer.address().port}`;
    gateway = { close: () => new Promise(resolve => gatewayServer.close(resolve)) };
  });

  after(async () => {
    await gateway.close();
    await Promise.all(upstreams.map(server => new Promise(resolve => server.close(resolve))));
  });

  async function request(path, options = {}) {
    const response = await fetch(new URL(path, gatewayUrl), options);
    return { status: response.status, body: await response.json() };
  }

  test('routes all applications by path on one origin', async () => {
    const checks = [
      ['/api/v1/payments?x=1', 'api', '/api/v1/payments?x=1'],
      ['/checkout/payment-123', 'checkout', '/checkout/payment-123'],
      ['/admin', 'admin', '/'],
      ['/store/wallet', 'store', '/wallet'],
      ['/api/payment-notification', 'store', '/api/payment-notification'],
      ['/api/v1/checkout/create', 'api', '/api/v1/checkout/create'],
      ['/help', 'help', '/help'],
      ['/support', 'help', '/support'],
      ['/oauth/callback?code=abc', 'gmail', '/oauth/callback?code=abc'],
      ['/api/services/start-all', 'admin', '/api/services/start-all'],
      ['/api/logs/stream', 'admin', '/api/logs/stream'],
      ['/api/admin/tickets', 'admin', '/api/admin/tickets'],
      ['/api/v1/admin/sms-gateway/download-apk', 'admin', '/api/v1/admin/sms-gateway/download-apk'],
      ['/youpi-sms-gateway.apk', 'admin', '/youpi-sms-gateway.apk'],
      ['/wallet', 'store', '/wallet'],
      ['/store/assets/logo.svg', 'store', '/assets/logo.svg'],
      ['/', 'admin', '/']
    ];

    for (const [path, service, upstreamPath] of checks) {
      const response = await request(path);
      assert.equal(response.status, 200, path);
      assert.equal(response.body.service, service, path);
      assert.equal(response.body.path, upstreamPath, path);
    }
  });

  test('preserves methods and request bodies through the gateway', async () => {
    const response = await request('/api/v1/observers/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'credited' })
    });
    assert.equal(response.body.method, 'POST');
    assert.equal(response.body.body, '{"message":"credited"}');
  });

  test('returns an application error for unknown paths', async () => {
    const response = await fetch(new URL('/not-a-route', gatewayUrl));
    assert.equal(response.status, 404);
  });
});
