import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Database } from '@youpi/db';
import { startAdminServer } from '../index.js';

describe('Merchant Admin Integration Tests', () => {
  let serverInstance;
  let baseUrl;
  let testDb;

  before(async () => {
    testDb = new Database({ inMemory: true });
    serverInstance = await startAdminServer(6101, { db: testDb, storeBaseUrl: 'https://pay.example.com/store' });
    baseUrl = `http://localhost:${serverInstance.port}`;
  });

  after(async () => {
    await serverInstance.close();
    testDb.close();
  });

  function get(path) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${path}`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        });
      }).on('error', reject);
    });
  }

  test('GET /health returns UP', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    const json = JSON.parse(res.text);
    assert.equal(json.status, 'UP');
    assert.equal(json.service, 'merchant-admin');
  });

  test('GET / renders dashboard with queue monitor, observers, counter desk & pairing modal', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));

    assert.ok(res.text.includes('Real-Time Receiving Account Slot Ownership'));
    assert.ok(res.text.includes('Active Slot (5-Minute Window)'));
    assert.ok(res.text.includes('Processing Slot (30s Verification Window)'));
    assert.ok(res.text.includes('Live Counter Payment Requests'));
    assert.ok(res.text.includes('Payment Observers (SMS & Gmail)'));
    assert.ok(res.text.includes('Android SMS Gateway'));
    assert.ok(res.text.includes('Gmail Direct API'));
    assert.ok(res.text.includes('href="https://pay.example.com/store" id="btnOpenStoreLink"'));
    assert.ok(res.text.includes('isProtected(url)'));
    assert.ok(res.text.includes('services(?:'));
    assert.ok(res.text.includes('/api/logs/stream?token=${encodeURIComponent(token)}'));
    assert.ok(res.text.includes('Last heartbeat: ${escapeHtml(heartbeatTime)}'));
    assert.ok(res.text.includes('Never connected'));
    assert.ok(res.text.includes('ONLINE'));
    assert.ok(res.text.includes('Historical payment records were preserved.'));
    assert.ok(res.text.includes('Failed to delete VPA'));
    assert.ok(res.text.includes("switchSection('storeSettings', 'subViewStoreVpa')"));
    assert.ok(res.text.includes("if (!['operations', 'storeSettings', 'developerHub', 'security'].includes(sectionId))"));
    assert.ok(res.text.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'));
    assert.ok(res.text.includes('button:focus-visible'));
    assert.ok(res.text.includes('prefers-reduced-motion: reduce'));
    assert.ok(res.text.includes('background:#fff;color:#0f172a;font-size:16px'));
  });

  test('GET / renders responsive developer hub and stable sub-navigation state', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('@media (max-width: 640px)'));
    assert.ok(res.text.includes('@media (max-width: 760px)'));
    assert.ok(res.text.includes('btn.dataset.subViewId = item.id'));
    assert.ok(res.text.includes('p.dataset.subViewId === subViewId'));
    assert.match(res.text, /id="simSelectedSessionBar"\s+style="display:none;[^"]*align-items:center;"/);
  });

  test('GET / defaults to dark mode and provides a persistent manual theme toggle', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /<html lang="en" data-theme="dark">/);
    assert.match(res.text, /<body data-theme="dark">/);
    assert.match(res.text, /id="headerThemeText">Real Dark</);
    assert.match(res.text, /id="headerThemeBadge" onclick="toggleThemeManual\(\)"/);
    assert.ok(res.text.includes("const ADMIN_THEME_STORAGE_KEY = 'youpi-admin-theme'"));
    assert.ok(res.text.includes('window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, nextTheme)'));
    assert.ok(res.text.includes('window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY)'));
  });

  test('GET /api/admin/tickets returns tickets array', async () => {
    const res = await get('/api/admin/tickets');
    assert.equal(res.status, 200);
    const json = JSON.parse(res.text);
    assert.ok(Array.isArray(json));
  });
});
