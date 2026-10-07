'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'je-test-'));
process.env.DB_PATH = path.join(tmp, 'test.sqlite');

const { db } = require('../src/db');
const billing = require('../src/services/billing');
const { hashPassword, verifyPassword, passwordProblem } = require('../src/security');
const { Validator } = require('../src/validate');

test.after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const DAY = 86400000;

test("Jackie's online packages are seeded and in-person ones are gone", () => {
  const pkgs = billing.listPackages({ includeInactive: true });
  assert.deepEqual(
    pkgs.map((p) => [p.slug, p.price_cents / 100]),
    [['online-junior-u18', 500], ['online-lifestyle', 1000], ['online-month-to-month', 1200], ['online-12-week', 2000], ['online-once-off', 2800]]
  );
  assert.ok(pkgs.every((p) => p.category === 'online'));
  assert.equal(billing.getPackageBySlug('online-12-week').billingLabel, 'once-off · 12 weeks');
  assert.equal(billing.getPackageBySlug('online-lifestyle').billingLabel, '/ month');
});

test('payment status: up to date, due soon, overdue, finished, not paid yet', () => {
  const nowMs = Date.parse('2026-10-06T12:00:00Z');
  const inDays = (d) => new Date(nowMs + d * DAY).toISOString();
  assert.equal(billing.paymentStatus(null, null, nowMs), 'unpaid');
  assert.equal(billing.paymentStatus(inDays(20), 'monthly', nowMs), 'current');
  assert.equal(billing.paymentStatus(inDays(3), 'monthly', nowMs), 'due');
  assert.equal(billing.paymentStatus(inDays(-2), 'monthly', nowMs), 'overdue');
  assert.equal(billing.paymentStatus(inDays(-2), 'once', nowMs), 'finished');
});

test('periods: months clamp to month end, weeks add whole weeks', () => {
  assert.equal(billing.addPeriod(new Date('2026-01-31T10:00:00Z'), 1, 'month').toISOString().slice(0, 10), '2026-02-28');
  assert.equal(billing.addPeriod(new Date('2026-10-06T10:00:00Z'), 3, 'month').toISOString().slice(0, 10), '2027-01-06');
  assert.equal(billing.addPeriod(new Date('2026-10-06T10:00:00Z'), 12, 'week').toISOString().slice(0, 10), '2026-12-29');
});

test('passwords hash and verify; weak passwords are rejected', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong password!!', hash), false);
  assert.ok(passwordProblem('short'));
  assert.ok(passwordProblem('password123'));
  assert.equal(passwordProblem('a decent passphrase'), null);
});

test('validator cleans South African phone numbers', () => {
  const v = new Validator({ phone: '+27 81 234 5678', email: 'nope' }).phone('phone').email('email');
  assert.equal(v.data.phone, '0812345678');
  assert.ok(v.errors.email);
});

test('guest checkout reuses the client by email without overwriting their details', () => {
  const id = billing.upsertClient({ first_name: 'Thandi', last_name: 'M', email: 'thandi@example.com', phone: '0821234567', consent: true }, 'checkout');
  const again = billing.upsertClient({ first_name: 'Someone', last_name: 'Else', email: 'THANDI@example.com', phone: '0830000000', consent: true }, 'checkout');
  assert.equal(again, id);
  const c = billing.getClient(id);
  assert.equal(c.first_name, 'Thandi');
  assert.equal(c.phone, '0821234567');
});

test('payments activate packages and stack per category', () => {
  const clientId = billing.upsertClient({ first_name: 'Sipho', last_name: 'D', email: 'sipho@example.com', consent: true }, 'checkout');
  const monthly = billing.getPackageBySlug('online-month-to-month');
  const once = billing.getPackageBySlug('online-12-week');

  const first = billing.createOrder({ clientId, pkg: monthly });
  assert.equal(billing.createOrder({ clientId, pkg: monthly }).id, first.id, 'an unpaid checkout is reused');
  assert.ok(first.pay_token.length >= 30, 'pay links use a long random token');
  assert.equal(billing.getOrderByToken(first.pay_token).id, first.id);
  assert.equal(billing.getOrderByToken('short'), null);
  assert.equal(billing.clientStatus(clientId).status, 'unpaid');
  assert.equal(billing.clientStatus(clientId).pending_package, 'Month-to-Month Program');

  assert.equal(billing.markOrderPaid(first.id, { method: 'payfast', pfPaymentId: '1' }), true);
  assert.equal(billing.markOrderPaid(first.id, { method: 'payfast', pfPaymentId: '1' }), false, 'duplicate notifications are ignored');

  assert.equal(billing.clientStatus(clientId).status, 'current');
  assert.equal(billing.clientStatus(clientId).paid_package, 'Month-to-Month Program');

  // Paying the next month early starts when the current one ends.
  const renewal = billing.recordManualPayment({ clientId, pkg: monthly, method: 'eft', amountCents: monthly.price_cents });
  const firstPaid = db.prepare('SELECT * FROM orders WHERE id = ?').get(first.id);
  assert.equal(renewal.period_start, firstPaid.period_end);

  // A once-off block follows on from what is already paid and covers 12 weeks.
  const block = billing.recordManualPayment({ clientId, pkg: once, method: 'cash' });
  assert.equal(block.period_start, renewal.period_end);
  assert.equal(Math.round((new Date(block.period_end) - new Date(block.period_start)) / DAY), 84);
  assert.equal(block.amount_cents, 200000);

  const row = billing.clientStatus(clientId);
  assert.equal(row.paid_package, '12 Week Transformation');
  assert.equal(row.paid_until, block.period_end);
  assert.equal(row.paid_count, 3);
});

test('the roster lists every client with their payment status', () => {
  const lapsed = billing.upsertClient({ first_name: 'Ayanda', last_name: 'Late', email: 'ayanda@example.com' }, 'coach');
  const order = billing.recordManualPayment({ clientId: lapsed, pkg: billing.getPackageBySlug('online-lifestyle'), method: 'eft' });
  db.prepare('UPDATE orders SET period_start = ?, period_end = ? WHERE id = ?').run(
    new Date(Date.now() - 40 * DAY).toISOString(), new Date(Date.now() - 10 * DAY).toISOString(), order.id
  );
  const roster = billing.clientRoster();
  const byEmail = Object.fromEntries(roster.map((c) => [c.email, c]));
  assert.equal(byEmail['ayanda@example.com'].status, 'overdue');
  assert.equal(byEmail['ayanda@example.com'].statusLabel, 'Overdue');
  assert.equal(byEmail['ayanda@example.com'].paid_package, 'Lifestyle Training');
  assert.equal(byEmail['sipho@example.com'].status, 'current');
  assert.ok(roster.every((c) => c.statusLabel && c.name));
});

test('cancelled orders cannot be cancelled twice and pending ones can', () => {
  const clientId = billing.upsertClient({ first_name: 'Lee', last_name: 'K', email: 'lee@example.com' }, 'coach');
  const order = billing.createOrder({ clientId, pkg: billing.getPackageBySlug('online-lifestyle'), createdBy: 'coach' });
  assert.equal(billing.setOrderStatus(order.id, 'cancelled'), true);
  assert.equal(billing.setOrderStatus(order.id, 'cancelled'), false);
});
