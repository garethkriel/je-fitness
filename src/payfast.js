'use strict';
// PayFast integration: signed checkout forms and Instant Transaction Notification (ITN) validation.
// Docs: https://developers.payfast.co.za/docs#step_1_form_fields and #step_4_confirm_payment
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const config = require('./config');
const { safeEqual } = require('./security');

// PHP urlencode() semantics, which PayFast uses when it computes signatures.
function pfEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function signPairs(pairs, passphrase) {
  let str = pairs.map(([k, v]) => `${k}=${pfEncode(v)}`).join('&');
  if (passphrase) str += `&passphrase=${pfEncode(passphrase)}`;
  return md5(str);
}

// Keep values PayFast echoes back free of characters that encode differently across libraries.
function cleanValue(value, max) {
  return String(value ?? '')
    .replace(/[!'()*~<>"`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function processUrl() {
  return `https://${config.payfast.host}/eng/process`;
}

/**
 * Build the ordered, signed field list for the PayFast checkout form.
 * The order of fields matters: it must match PayFast's documented attribute order.
 */
function buildCheckoutFields({ order, client, brand }) {
  const payUrl = `${config.publicUrl}/pay/${order.pay_token}`;
  const fields = [
    ['merchant_id', config.payfast.merchantId],
    ['merchant_key', config.payfast.merchantKey],
    ['return_url', `${payUrl}/done`],
    ['cancel_url', `${payUrl}?cancelled=1`],
    ['notify_url', `${config.publicUrl}/payfast/notify`],
    ['name_first', cleanValue(client.first_name, 100)],
    ['name_last', cleanValue(client.last_name, 100)],
    ['email_address', cleanValue(client.email, 100)],
    ['cell_number', /^0\d{9}$/.test(client.phone || '') ? client.phone : ''],
    ['m_payment_id', order.reference],
    ['amount', (order.amount_cents / 100).toFixed(2)],
    ['item_name', cleanValue(`${brand} - ${order.package_name}`, 100)],
    ['item_description', cleanValue(`Personal training for ${client.first_name} ${client.last_name}`, 255)],
  ].filter(([, v]) => v !== '' && v !== null && v !== undefined);

  if (config.payfast.signCheckout) fields.push(['signature', signPairs(fields, config.payfast.passphrase)]);
  return fields;
}

// ---------------------------------------------------------------------------------------------
// ITN validation
// ---------------------------------------------------------------------------------------------

const PAYFAST_HOSTS = ['www.payfast.co.za', 'sandbox.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za'];
const PAYFAST_RANGES = [
  ['197.97.145.144', 28],
  ['41.74.179.192', 27],
  ['102.216.36.0', 28],
  ['102.216.36.128', 28],
  ['144.126.193.139', 32],
];
const blockList = new net.BlockList();
for (const [address, prefix] of PAYFAST_RANGES) blockList.addSubnet(address, prefix, 'ipv4');

function normaliseIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

async function isPayfastIp(ip, lookup = dns.lookup) {
  const addr = normaliseIp(ip);
  if (!net.isIP(addr)) return false;
  if (net.isIPv4(addr) && blockList.check(addr, 'ipv4')) return true;
  const results = await Promise.allSettled(PAYFAST_HOSTS.map((h) => lookup(h, { all: true })));
  return results.some((r) => r.status === 'fulfilled' && r.value.some((a) => normaliseIp(a.address) === addr));
}

async function confirmWithPayfast(paramString, fetchImpl = fetch) {
  const res = await fetchImpl(`https://${config.payfast.host}/eng/query/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: paramString,
    signal: AbortSignal.timeout(10_000),
  });
  const text = (await res.text()).trim();
  return res.ok && text === 'VALID';
}

/**
 * Run PayFast's four security checks against a raw ITN body.
 * Returns { ok, reason, data, order }.
 */
async function verifyItn(rawBody, ip, { findOrder, lookup, fetchImpl } = {}) {
  const pairs = [...new URLSearchParams(String(rawBody || ''))];
  const data = Object.fromEntries(pairs);
  const fail = (reason, order = null) => ({ ok: false, reason, data, order });

  // 1. Signature: every field up to (not including) "signature", in the order received.
  const sigIndex = pairs.findIndex(([k]) => k === 'signature');
  if (sigIndex === -1) return fail('missing signature');
  const signed = pairs.slice(0, sigIndex);
  const paramString = signed.map(([k, v]) => `${k}=${pfEncode(v)}`).join('&');
  const expected = signPairs(signed, config.payfast.passphrase);
  if (!safeEqual(expected, data.signature)) return fail('signature mismatch');

  if (data.merchant_id !== config.payfast.merchantId) return fail('merchant id mismatch');

  // 2. The order exists and 3. the amount matches what we asked for.
  const order = findOrder ? findOrder(data.m_payment_id) : null;
  if (!order) return fail('unknown order');
  const gross = Math.round(Number(data.amount_gross) * 100);
  if (!Number.isFinite(gross) || Math.abs(gross - order.amount_cents) > 1) return fail('amount mismatch', order);

  // 4. The request really came from PayFast...
  if (!(await isPayfastIp(ip, lookup))) return fail('request not from a PayFast server', order);

  // ...and PayFast confirms the data it sent.
  try {
    if (!(await confirmWithPayfast(paramString, fetchImpl))) return fail('PayFast did not confirm the payment', order);
  } catch (err) {
    return fail(`could not reach PayFast to confirm (${err.name})`, order);
  }

  return { ok: true, reason: null, data, order };
}

module.exports = { pfEncode, signPairs, buildCheckoutFields, processUrl, verifyItn, isPayfastIp };
