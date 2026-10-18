import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CustomerRepository, Database } from '@youpi/db';
import { startServer as startPaymentApi } from '../../../payment-api/src/index.js';
import { startCoinWalletStore } from '../index.js';
import { generateHmac } from '@youpi/common';

describe('Coin Top-Up Wallet Demo Store Integration Tests', () => {
  let apiInstance;
  let storeInstance;
  let storeBaseUrl;
  let testDb;
  const whatsappMessages = [];
  const storeSecret = 'wallet_store_secret_9988';

  before(async () => {
    testDb = new Database({ inMemory: true });
    apiInstance = await startPaymentApi(6193, testDb);
    apiInstance.app.context.whatsappBerryService.sendMessage = async (to, message) => {
      whatsappMessages.push({ to, message });
      return { success: true, delivered: true };
    };

    // Update demo merchant with our store webhook secret
    testDb.execute('UPDATE merchants SET webhook_secret = ?, webhook_url = ? WHERE id = ?', [
      storeSecret,
      'http://localhost:5099/api/webhook',
      '00000000-0000-0000-0000-000000000001'
    ]);

    storeInstance = await startCoinWalletStore(5099, {
      gatewayApiUrl: `http://localhost:${apiInstance.port}`,
      merchantId: '00000000-0000-0000-0000-000000000001',
      webhookSecret: storeSecret
    });

    storeBaseUrl = `http://localhost:${storeInstance.port}`;
  });

  after(async () => {
    await storeInstance.close();
    await apiInstance.close();
    testDb.close();
  });

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, storeBaseUrl);
      const req = http.request(url, {
        method: options.method || 'GET',
        headers: options.headers || {}
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let body;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });

      req.on('error', reject);
      if (options.body) {
        const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        req.setHeader('Content-Type', 'application/json');
        req.write(payload);
      }
      req.end();
    });
  }

  test('GET /health returns UP and initial balance', async () => {
    const res = await request('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'UP');
    assert.equal(res.body.coins, 50);
  });

  test('GET / renders YOUPI Store product page with gateway showcase and demo checkout', async () => {
    const res = await request('/');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Self-Hosted UPI Payment Gateway'));
    assert.ok(res.body.includes('₹1.00'));
    assert.ok(res.body.includes('/assets/gateway_pc_checkout.png'));

    const inlineScripts = [...res.body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes))
      .map(([, , script]) => script);
    assert.ok(inlineScripts.length > 0, 'store page should include its inline controller');
    for (const script of inlineScripts) {
      assert.doesNotThrow(() => new Function(script), 'inline store JavaScript should parse');
    }
  });

  test('POST /api/checkout initiates payment gateway session and returns checkoutUrl', async () => {
    const checkoutRes = await request('/api/checkout', {
      method: 'POST',
      body: {
        packName: 'Gamer Pack',
        coins: 550,
        price: 449.00,
        phoneNumber: '9876543210',
        gamerTag: 'ViperX'
      }
    });

    assert.equal(checkoutRes.status, 200);
    assert.ok(checkoutRes.body.orderId.startsWith('COIN-ORD-'));
    assert.ok(checkoutRes.body.paymentId);
    assert.ok(checkoutRes.body.checkoutUrl.includes('/checkout/'));
  });

  test('POST /api/payment-notification sends one verified WhatsApp update for every terminal payment status', async () => {
    const customer = new CustomerRepository(testDb).create({
      name: 'Payment Test Customer',
      email: 'payment-test@example.com',
      mobileNumber: '9876543210',
      isPhoneVerified: true
    });

    for (const status of ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED']) {
      const checkoutRes = await request('/api/checkout', {
        method: 'POST',
        body: { price: 25.5 }
      });
      assert.equal(checkoutRes.status, 200);

      testDb.execute(
        'UPDATE payment_sessions SET customer_id = ?, status = ?, method = ?, completed_at = ? WHERE id = ?',
        [customer.id, status, 'UPI', new Date().toISOString(), checkoutRes.body.paymentId]
      );

      const notification = await request('/api/payment-notification', {
        method: 'POST',
        body: { orderId: checkoutRes.body.orderId }
      });
      assert.equal(notification.status, 200);
      assert.equal(notification.body.sent, true);
      assert.equal(notification.body.status, status);

      const sent = whatsappMessages.at(-1);
      assert.equal(sent.to, customer.mobileNumber);
      assert.ok(sent.message.includes(`Status: ${status}`));
      assert.ok(sent.message.includes(`Order ID: ${checkoutRes.body.orderId}`));
      assert.ok(sent.message.includes('Amount: INR 25.50'));
      assert.ok(sent.message.includes('Customer: Payment Test Customer'));

      const duplicate = await request('/api/payment-notification', {
        method: 'POST',
        body: { orderId: checkoutRes.body.orderId }
      });
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body.alreadySent, true);
    }

    assert.equal(whatsappMessages.length, 4);

    const recoveredCheckout = await request('/api/checkout', {
      method: 'POST',
      body: { price: 25.5 }
    });
    testDb.execute(
      'UPDATE payment_sessions SET customer_id = ?, status = ?, method = ?, completed_at = ? WHERE id = ?',
      [customer.id, 'SUCCESS', 'UPI', new Date().toISOString(), recoveredCheckout.body.paymentId]
    );
    storeInstance.server.orderPayments.delete(recoveredCheckout.body.orderId);
    const recoveredNotification = await request('/api/payment-notification', {
      method: 'POST',
      body: { orderId: recoveredCheckout.body.orderId }
    });
    assert.equal(recoveredNotification.status, 200);
    assert.equal(recoveredNotification.body.sent, true);
    assert.equal(recoveredNotification.body.status, 'SUCCESS');
    assert.equal(whatsappMessages.length, 5);

    const unverifiedCustomer = new CustomerRepository(testDb).create({
      name: 'Unverified Test Customer',
      email: 'unverified-test@example.com',
      mobileNumber: '9876543211'
    });
    const checkoutRes = await request('/api/checkout', {
      method: 'POST',
      body: { price: 25.5 }
    });
    testDb.execute(
      'UPDATE payment_sessions SET customer_id = ?, status = ?, method = ? WHERE id = ?',
      [unverifiedCustomer.id, 'SUCCESS', 'UPI', checkoutRes.body.paymentId]
    );
    const unverifiedNotification = await request('/api/payment-notification', {
      method: 'POST',
      body: { orderId: checkoutRes.body.orderId }
    });
    assert.equal(unverifiedNotification.status, 409);
    assert.equal(unverifiedNotification.body.sent, false);
    assert.equal(whatsappMessages.length, 5);
  });

  test('POST /api/webhook processes signed SUCCESS event and credits wallet coins', async () => {
    const initialCoins = storeInstance.server.walletCoins;

    const payloadObj = {
      event: 'SUCCESS',
      paymentId: 'pay_coin_test_123',
      orderId: 'COIN-ORD-555',
      amount: '449.00',
      amountPaise: 44900,
      currency: 'INR',
      method: 'UPI',
      metadata: {
        coins: 550,
        packName: 'Gamer Pack'
      }
    };

    const payloadString = JSON.stringify(payloadObj);
    const signature = generateHmac(payloadString, storeSecret);

    const hookRes = await request('/api/webhook', {
      method: 'POST',
      headers: {
        'X-Gateway-Signature': `sha256=${signature}`
      },
      body: payloadString
    });

    assert.equal(hookRes.status, 200);
    assert.equal(hookRes.body.credited, true);

    // Verify coins were credited to wallet!
    assert.equal(storeInstance.server.walletCoins, initialCoins + 550);

    // Verify recorded in ledger
    const balanceRes = await request('/api/wallet-balance');
    assert.equal(balanceRes.body.coins, initialCoins + 550);
    assert.ok(balanceRes.body.history.length >= 1);
    assert.equal(balanceRes.body.history[0].orderId, 'COIN-ORD-555');

    const customer = new CustomerRepository(testDb).create({
      name: 'Webhook Test Customer',
      email: 'webhook-test@example.com',
      mobileNumber: '9876543212',
      isPhoneVerified: true
    });
    const checkout = await request('/api/checkout', {
      method: 'POST',
      body: { price: 25.5 }
    });
    testDb.execute(
      'UPDATE payment_sessions SET customer_id = ?, status = ?, method = ?, completed_at = ? WHERE id = ?',
      [customer.id, 'SUCCESS', 'UPI', new Date().toISOString(), checkout.body.paymentId]
    );
    const notificationEvent = {
      event: 'SUCCESS',
      paymentId: checkout.body.paymentId,
      orderId: checkout.body.orderId,
      amount: '25.50',
      currency: 'INR',
      method: 'UPI',
      metadata: { coins: 26, packName: 'Webhook Test Top-Up' }
    };
    const notificationBody = JSON.stringify(notificationEvent);
    const notificationWebhook = await request('/api/webhook', {
      method: 'POST',
      headers: { 'X-Gateway-Signature': `sha256=${generateHmac(notificationBody, storeSecret)}` },
      body: notificationBody
    });
    assert.equal(notificationWebhook.status, 200);
    assert.equal(whatsappMessages.at(-1).to, customer.mobileNumber);
    assert.ok(whatsappMessages.at(-1).message.includes(`Order ID: ${checkout.body.orderId}`));
    assert.ok(whatsappMessages.at(-1).message.includes('Status: SUCCESS'));
  });

  test('POST /api/webhook rejects fraudulent signature', async () => {
    const payloadString = JSON.stringify({ event: 'SUCCESS', orderId: 'FAKE' });
    const hookRes = await request('/api/webhook', {
      method: 'POST',
      headers: {
        'X-Gateway-Signature': 'sha256=invalid_fake_signature_hash'
      },
      body: payloadString
    });

    assert.equal(hookRes.status, 400);
    assert.ok(hookRes.body.error.includes('signature mismatch'));
  });

  test('GET /wallet renders wallet page with updated balance', async () => {
    const res = await request('/wallet?orderId=COIN-ORD-555');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Customer Account') || res.body.includes('YOUPI Store'));
    assert.ok(res.body.includes('Top-Up Successful!'));
    assert.ok(res.body.includes('Current Vault Balance'));
  });

  test('custom top-up: initiates custom amount payment and credits calculated coins on webhook', async () => {
    const initialCoins = storeInstance.server.walletCoins;
    const customAmount = 250.00;
    const customCoins = 250; // 1 rs = 1 coin

    const checkoutRes = await request('/api/checkout', {
      method: 'POST',
      body: {
        packName: 'Custom Top-Up',
        coins: customCoins,
        price: customAmount,
        phoneNumber: '9876543210',
        gamerTag: 'CustomGamer'
      }
    });

    assert.equal(checkoutRes.status, 200);
    assert.ok(checkoutRes.body.checkoutUrl);
    const orderId = checkoutRes.body.orderId;

    // Simulate signed webhook receipt
    const payloadObj = {
      event: 'SUCCESS',
      paymentId: checkoutRes.body.paymentId,
      orderId,
      amount: '250.00',
      amountPaise: 25000,
      currency: 'INR',
      method: 'UPI',
      metadata: {
        coins: customCoins,
        packName: 'Custom Top-Up'
      }
    };

    const payloadString = JSON.stringify(payloadObj);
    const signature = generateHmac(payloadString, storeSecret);

    const hookRes = await request('/api/webhook', {
      method: 'POST',
      headers: { 'X-Gateway-Signature': `sha256=${signature}` },
      body: payloadString
    });

    assert.equal(hookRes.status, 200);
    assert.equal(storeInstance.server.walletCoins, initialCoins + customCoins);
  });

  test('minimum amount: allows exactly ₹1.00 top-up and credits 1 coin', async () => {
    const initialCoins = storeInstance.server.walletCoins;

    const checkoutRes = await request('/api/checkout', {
      method: 'POST',
      body: {
        packName: 'Micro Top-Up',
        coins: 1,
        price: 1.00,
        phoneNumber: '9876543210'
      }
    });

    assert.equal(checkoutRes.status, 200);
    const orderId = checkoutRes.body.orderId;

    const payloadObj = {
      event: 'SUCCESS',
      paymentId: checkoutRes.body.paymentId,
      orderId,
      amount: '1.00',
      amountPaise: 100,
      currency: 'INR',
      method: 'UPI',
      metadata: { coins: 1, packName: 'Micro Top-Up' }
    };
    const payloadString = JSON.stringify(payloadObj);
    const signature = generateHmac(payloadString, storeSecret);

    const hookRes = await request('/api/webhook', {
      method: 'POST',
      headers: { 'X-Gateway-Signature': `sha256=${signature}` },
      body: payloadString
    });

    assert.equal(hookRes.status, 200);
    assert.equal(storeInstance.server.walletCoins, initialCoins + 1);
  });

  test('minimum amount: rejects top-up of less than ₹1.00', async () => {
    const checkoutRes = await request('/api/checkout', {
      method: 'POST',
      body: {
        packName: 'Zero Top-Up',
        coins: 0,
        price: 0.50
      }
    });

    assert.equal(checkoutRes.status, 400);
    assert.ok(checkoutRes.body.error.includes('Minimum top-up amount is ₹1.00'));
  });

  test('GET /order-failed renders failed order page with deep link to support', async () => {
    const res = await request('/order-failed?orderId=COIN-ORD-999&reason=FAILED&paymentId=pay_fail_123');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Payment Unsuccessful'));
    assert.ok(res.body.includes('COIN-ORD-999'));
    assert.ok(res.body.includes('Contact Payment Support'));
    assert.ok(res.body.includes('Try Again'));
    assert.ok(res.body.includes('/api/payment-notification'));
  });

  test('POST /api/verify-payment refuses to credit unknown orders and unpaid payments', async () => {
    const before = storeInstance.server.walletCoins;

    const unknown = await request('/api/verify-payment', {
      method: 'POST',
      body: { orderId: 'COIN-ORD-FORGED', coins: 999999, paymentId: 'x' }
    });
    assert.equal(unknown.status, 404);

    const checkout = await request('/api/checkout', { method: 'POST', body: { price: 100, coins: 100, packName: 'Starter Pack' } });
    assert.equal(checkout.status, 200);
    const unpaid = await request('/api/verify-payment', {
      method: 'POST',
      body: { orderId: checkout.body.orderId, coins: 999999 }
    });
    assert.equal(unpaid.status, 402);
    assert.equal(storeInstance.server.walletCoins, before);
  });

  test('POST /api/verify-payment credits coins only after the gateway reports SUCCESS, and is idempotent', async () => {
    const initialCoins = storeInstance.server.walletCoins;
    const checkout = await request('/api/checkout', { method: 'POST', body: { price: 100, coins: 100, packName: 'Starter Pack' } });
    assert.equal(checkout.status, 200);
    const { orderId, paymentId } = checkout.body;

    // Simulate the gateway verification engine completing this UPI payment.
    testDb.execute("UPDATE payment_sessions SET status = 'SUCCESS', method = 'UPI' WHERE id = ?", [paymentId]);

    const verifyRes = await request('/api/verify-payment', {
      method: 'POST',
      body: { orderId, coins: 999999, packName: 'Ignored' }
    });
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.success, true);
    // Client-supplied coin counts are ignored: the gateway session metadata wins.
    assert.equal(storeInstance.server.walletCoins, initialCoins + 100);

    const dupRes = await request('/api/verify-payment', { method: 'POST', body: { orderId } });
    assert.equal(dupRes.status, 200);
    assert.equal(dupRes.body.message, 'Already credited');
    assert.equal(storeInstance.server.walletCoins, initialCoins + 100);
  });

  test('GET /order-success renders verified payment page with parameters', async () => {
    const res = await request('/order-success?order_id=ORD-SUCC-123&amount=499.00&utr=998877665544&mode=UPI');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Payment Successful!'));
    assert.ok(res.body.includes('ORD-SUCC-123'));
    assert.ok(res.body.includes('499.00'));
    assert.ok(res.body.includes('998877665544'));
    assert.ok(res.body.includes('VERIFIED BY YOUPI PG'));
    assert.ok(res.body.includes('/api/payment-notification'));
  });

  test('GET /order-suspicious renders held for review security notice', async () => {
    const res = await request('/order-suspicious?order_id=ORD-SUSP-456');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Payment Under Review'));
    assert.ok(res.body.includes('ORD-SUSP-456'));
    assert.ok(res.body.includes('SECURITY NOTICE'));
  });

  test('GET /order-expired renders expired session notice', async () => {
    const res = await request('/order-expired?order_id=ORD-EXP-789');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Payment Session Expired'));
    assert.ok(res.body.includes('ORD-EXP-789'));
    assert.ok(res.body.includes('/api/payment-notification'));
  });

  test('GET /order-cancelled renders cancelled session notice', async () => {
    const res = await request('/order-cancelled?order_id=ORD-CAN-000');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Payment Cancelled'));
    assert.ok(res.body.includes('ORD-CAN-000'));
    assert.ok(res.body.includes('/api/payment-notification'));
  });

  test('GET /youpi.js is served with CORS for universal frontend integration', async () => {
    const res = await request('/youpi.js');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('YoupiCheckout'));
    assert.ok(res.body.includes('data-youpi-pay'));
  });

  test('Reverse proxy: proxies /api/v1/* requests to payment API directly', async () => {
    const res = await request('/api/v1/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'UP');
  });

  test('Reverse proxy: /checkout/* does not return 404 Route Not Found', async () => {
    const res = await request('/checkout/some-session-id');
    // It should either return 200/502 (if portal not up on that test port), but NEVER 404 "Route Not Found"
    assert.notEqual(res.body, 'Route Not Found');
  });
});
