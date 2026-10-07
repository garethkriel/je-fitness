'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.PAYFAST_SANDBOX = 'true';
process.env.PAYFAST_SANDBOX_MERCHANT_ID = '10012345';
process.env.PAYFAST_SANDBOX_MERCHANT_KEY = 'testmerchantkey';
process.env.PAYFAST_SANDBOX_PASSPHRASE = 'A test passphrase (with symbols)!';
const config = require('../src/config');
const { pfEncode, signPairs, buildCheckoutFields, verifyItn } = require('../src/payfast');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

test('pfEncode matches PHP urlencode()', () => {
  assert.equal(pfEncode('Fat Loss - 1 month'), 'Fat+Loss+-+1+month');
  assert.equal(pfEncode("a(b)c!d'e*f~g"), 'a%28b%29c%21d%27e%2Af%7Eg');
  assert.equal(pfEncode('https://x.co/p?ref=A&b=1'), 'https%3A%2F%2Fx.co%2Fp%3Fref%3DA%26b%3D1');
});

test('checkout fields are signed in order with the passphrase', () => {
  const fields = buildCheckoutFields({
    order: { reference: 'JE20261006-ABC', pay_token: 'tok_abcdefghijklmnopqrstuvwxyz', amount_cents: 184000, package_name: 'Month-to-Month Program' },
    client: { first_name: 'Thandi', last_name: "O'Brien", email: 'thandi@example.com', phone: '0821234567' },
    brand: 'JE Fitness',
  });
  const sig = fields.pop();
  assert.equal(sig[0], 'signature');
  assert.equal(fields[0][0], 'merchant_id');
  assert.ok(fields.find(([k, v]) => k === 'name_last' && v === 'OBrien'), 'apostrophes are stripped from echoed values');
  assert.ok(fields.find(([k, v]) => k === 'amount' && v === '1840.00'));
  assert.ok(fields.find(([k, v]) => k === 'return_url' && v.endsWith('/pay/tok_abcdefghijklmnopqrstuvwxyz/done')));
  const expected = md5(fields.map(([k, v]) => `${k}=${pfEncode(v)}`).join('&') + `&passphrase=${pfEncode(config.payfast.passphrase)}`);
  assert.equal(sig[1], expected);
});

function itnBody(overrides = {}) {
  const pairs = [
    ['m_payment_id', 'JE20261006-ABC'],
    ['pf_payment_id', '1089250'],
    ['payment_status', 'COMPLETE'],
    ['item_name', 'Fat Loss - 1 month coaching'],
    ['item_description', ''],
    ['amount_gross', '800.00'],
    ['amount_fee', '-18.40'],
    ['amount_net', '781.60'],
    ['name_first', 'Thandi'],
    ['name_last', 'OBrien'],
    ['email_address', 'thandi@example.com'],
    ['merchant_id', config.payfast.merchantId],
  ].map(([k, v]) => [k, overrides[k] ?? v]);
  pairs.push(['signature', signPairs(pairs, config.payfast.passphrase)]);
  return new URLSearchParams(pairs).toString();
}

const order = { id: 1, reference: 'JE20261006-ABC', amount_cents: 80000 };
const deps = (extra = {}) => ({
  findOrder: (ref) => (ref === order.reference ? order : null),
  lookup: async () => [{ address: '41.74.179.200' }],
  fetchImpl: async () => new Response('VALID'),
  ...extra,
});

test('a genuine ITN passes all four checks', async () => {
  const result = await verifyItn(itnBody(), '197.97.145.150', deps());
  assert.equal(result.reason, null);
  assert.equal(result.ok, true);
  assert.equal(result.data.pf_payment_id, '1089250');
});

test('IPv4-mapped PayFast addresses are accepted', async () => {
  const result = await verifyItn(itnBody(), '::ffff:197.97.145.150', deps());
  assert.equal(result.ok, true);
});

test('tampered data fails the signature check', async () => {
  const body = itnBody().replace('amount_gross=800.00', 'amount_gross=8.00');
  const result = await verifyItn(body, '197.97.145.150', deps());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'signature mismatch');
});

test('a correctly signed but underpaid ITN is rejected', async () => {
  const result = await verifyItn(itnBody({ amount_gross: '10.00' }), '197.97.145.150', deps());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'amount mismatch');
});

test('unknown orders are rejected', async () => {
  const result = await verifyItn(itnBody({ m_payment_id: 'NOPE' }), '197.97.145.150', deps());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown order');
});

test('notifications from outside PayFast are rejected', async () => {
  const result = await verifyItn(itnBody(), '8.8.8.8', deps());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'request not from a PayFast server');
});

test('notifications PayFast does not confirm are rejected', async () => {
  const result = await verifyItn(itnBody(), '197.97.145.150', deps({ fetchImpl: async () => new Response('INVALID') }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /did not confirm/);
});

test('missing signature is rejected', async () => {
  const result = await verifyItn('m_payment_id=JE20261006-ABC&amount_gross=800.00', '197.97.145.150', deps());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing signature');
});
