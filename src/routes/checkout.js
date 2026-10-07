'use strict';
// Guest checkout: the client enters their details, pays on PayFast, and lands on a confirmation page.
// Every order has an unguessable pay link (/pay/<token>) that the coach can also send to a client.
const express = require('express');
const { db, now, audit } = require('../db');
const site = require('../site');
const limits = require('../limits');
const payfast = require('../payfast');
const { Validator } = require('../validate');
const billing = require('../services/billing');

const router = express.Router();

function notFound(res, message = 'That package is no longer available.') {
  res.status(404).render('error', { title: 'Not found', status: 404, message });
}

function renderCheckout(res, pkg, { values = {}, errors = {}, status = 200 } = {}) {
  res.status(status).render('checkout', { title: `Checkout - ${pkg.name}`, pkg, values, errors, page: 'checkout' });
}

router.get('/checkout/:slug', (req, res) => {
  const pkg = billing.getPackageBySlug(req.params.slug);
  if (!pkg) return notFound(res);
  renderCheckout(res, pkg, { values: { under_18: Boolean(pkg.max_age) } });
});

router.post('/checkout/:slug', limits.checkout, (req, res) => {
  const pkg = billing.getPackageBySlug(req.params.slug);
  if (!pkg) return notFound(res);

  const v = new Validator(req.body)
    .text('first_name', { label: 'First name', required: true, max: 60 })
    .text('last_name', { label: 'Last name', required: true, max: 60 })
    .email('email')
    .phone('phone', { label: 'Cellphone number', required: true })
    .text('goal', { label: 'Your goal', max: 500, multiline: true })
    .checked('under_18')
    .text('guardian_name', { label: 'Guardian name', max: 120 })
    .phone('guardian_phone', { label: 'Guardian cellphone' })
    .checked('guardian_consent')
    .checked('health_declaration', { message: 'Please confirm the health declaration.' })
    .checked('agree_terms', { message: 'Please accept the terms and privacy policy.' });
  const d = v.data;

  const minor = d.under_18 || Boolean(pkg.max_age);
  if (minor) {
    if (!d.guardian_name) v.fail('guardian_name', 'A parent or guardian name is required for under-18s.');
    if (!d.guardian_phone && !v.errors.guardian_phone) v.fail('guardian_phone', 'A parent or guardian cellphone number is required for under-18s.');
    if (!d.guardian_consent) v.fail('guardian_consent', 'A parent or guardian must give consent.');
  }
  if (!v.ok) return renderCheckout(res, pkg, { values: { ...d, under_18: minor }, errors: v.errors, status: 422 });

  const clientId = billing.upsertClient(
    {
      ...d,
      guardian_name: minor ? d.guardian_name : '',
      guardian_phone: minor ? d.guardian_phone : '',
      consent: true,
    },
    'checkout'
  );
  const order = billing.createOrder({ clientId, pkg, createdBy: 'client' });
  audit(req, 'checkout_started', `${order.reference} ${pkg.fullName} ${d.email}`);
  res.redirect(303, `/pay/${order.pay_token}`);
});

function payPage(req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const order = billing.getOrderByToken(req.params.token);
  if (!order) return notFound(res, 'This payment link is not valid. Please choose your package again.');
  req.order = order;
  next();
}

router.get('/pay/:token', payPage, (req, res) => {
  const { order } = req;
  if (order.status === 'paid') return res.redirect(`/pay/${order.pay_token}/done`);
  const client = billing.getClient(order.client_id);
  const pkg = billing.getPackageById(order.package_id);
  res.render('pay', {
    title: 'Secure payment',
    noindex: true,
    order,
    client,
    pkg,
    cancelled: req.query.cancelled === '1',
    action: payfast.processUrl(),
    fields: order.status === 'pending' ? payfast.buildCheckoutFields({ order, client, brand: site.brand }) : [],
  });
});

router.get('/pay/:token/done', payPage, (req, res) => {
  res.render('pay-done', { title: 'Payment received', noindex: true, order: req.order, client: billing.getClient(req.order.client_id) });
});

router.get('/pay/:token/status', payPage, (req, res) => {
  res.json({ status: req.order.status });
});

// PayFast server-to-server notification. Mounted before the body parsers so the raw body is available.
async function itnHandler(req, res) {
  // Acknowledge straight away; PayFast retries if it does not get a 200.
  res.status(200).end();

  const raw = typeof req.body === 'string' ? req.body : '';
  let result;
  try {
    result = await payfast.verifyItn(raw, req.ip, { findOrder: billing.getOrderByReference });
  } catch (err) {
    result = { ok: false, reason: `error: ${err.message}`, data: {}, order: null };
  }
  const { ok, reason, data, order } = result;

  db.prepare(
    `INSERT INTO payment_events (order_reference, pf_payment_id, payment_status, amount_gross, valid, reason, ip, payload, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(data.m_payment_id || '').slice(0, 100),
    String(data.pf_payment_id || '').slice(0, 100),
    String(data.payment_status || '').slice(0, 30),
    String(data.amount_gross || '').slice(0, 30),
    ok ? 1 : 0,
    reason,
    req.ip,
    raw.slice(0, 5000),
    now()
  );

  if (!ok) {
    console.warn(`[payfast] rejected ITN for ${data.m_payment_id || 'unknown order'}: ${reason}`);
    return;
  }
  if (data.payment_status === 'COMPLETE') {
    if (billing.markOrderPaid(order.id, { method: 'payfast', pfPaymentId: data.pf_payment_id })) {
      console.log(`[payfast] order ${order.reference} paid (${data.pf_payment_id})`);
    }
  } else if (data.payment_status === 'CANCELLED') {
    billing.setOrderStatus(order.id, 'cancelled');
  } else if (data.payment_status === 'FAILED') {
    billing.setOrderStatus(order.id, 'failed');
  }
}

module.exports = {
  router,
  itnHandler,
  itnBodyParser: express.text({ type: 'application/x-www-form-urlencoded', limit: '20kb' }),
};
