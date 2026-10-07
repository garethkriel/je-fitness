'use strict';
// Sample clients and payments for the preview site (DEMO_DATA=1), so the dashboard shows every payment status.
// Only ever runs in PayFast test mode and only on an empty database.

const { db, now } = require('./db');
const config = require('./config');
const billing = require('./services/billing');

const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

const CLIENTS = [
  // [first, last, phone, goal, payments: [package slug, days ago, method], pending package slug]
  ['Naledi', 'Khumalo', '0825550101', 'Lose 8 kg before December', [['online-month-to-month', 34, 'payfast']], 'online-month-to-month'],
  ['Sipho', 'Nkosi', '0835550102', 'Build muscle', [['online-lifestyle', 41, 'eft']], null],
  ['Anel', 'Botha', '0845550103', 'Get fit for netball season', [], 'online-junior-u18'],
  ['Lerato', 'Dlamini', '0715550104', 'Tone up and eat better', [['online-month-to-month', 27, 'payfast']], null],
  ['Pieter', 'van Wyk', '0605550105', 'First bodybuilding show', [['online-12-week', 20, 'payfast']], null],
  ['Thandi', 'Mokoena', '0725550106', 'More energy, less stress', [['online-lifestyle', 5, 'payfast']], null],
  ['Johan', 'Pretorius', '0765550107', 'Lose the lockdown weight', [['online-once-off', 100, 'cash']], null],
];

function seedDemoData() {
  if (!config.payfast.sandbox) {
    console.warn('[demo] DEMO_DATA is ignored while PayFast is in live mode.');
    return false;
  }
  if (db.prepare('SELECT 1 FROM clients LIMIT 1').get()) return false;

  for (const [first, last, phone, goal, payments, pendingSlug] of CLIENTS) {
    const junior = pendingSlug === 'online-junior-u18';
    const clientId = billing.upsertClient(
      {
        first_name: first,
        last_name: last,
        email: `${first}.${last.replace(/\s+/g, '')}@example.com`.toLowerCase(),
        phone,
        goal,
        guardian_name: junior ? 'Marelize Botha' : null,
        guardian_phone: junior ? '0845550199' : null,
        consent: true,
      },
      'checkout'
    );
    db.prepare('UPDATE clients SET notes = ? WHERE id = ?').run('Sample client for the preview.', clientId);

    for (const [slug, ago, method] of payments) {
      const pkg = billing.getPackageBySlug(slug);
      const order = billing.createOrder({ clientId, pkg, createdBy: method === 'payfast' ? 'client' : 'coach' });
      billing.markOrderPaid(order.id, { method, pfPaymentId: method === 'payfast' ? String(1090000 + order.id) : null });
      const start = daysAgo(ago);
      const end = billing.addPeriod(start, order.period_count, order.period_unit);
      db.prepare('UPDATE orders SET created_at = ?, paid_at = ?, period_start = ?, period_end = ? WHERE id = ?').run(
        start.toISOString(), start.toISOString(), start.toISOString(), end.toISOString(), order.id
      );
    }
    if (pendingSlug) billing.createOrder({ clientId, pkg: billing.getPackageBySlug(pendingSlug), createdBy: 'coach' });
  }

  db.prepare('INSERT INTO enquiries (name, email, phone, interest, message, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'Megan Smith', 'megan.smith@example.com', '0795550108', 'online-lifestyle',
    'Hi Jackie, I train at home with dumbbells only. Would the Lifestyle package work for me?', null, now()
  );
  console.log(`[demo] Added ${CLIENTS.length} sample clients and a sample enquiry for the preview.`);
  return true;
}

module.exports = { seedDemoData };
