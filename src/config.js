'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parseTrustProxy(value) {
  if (value === undefined || value === '' || /^false$/i.test(value)) return false;
  if (/^\d+$/.test(value)) return Number(value);
  // Never accept a blanket "true": it would let anyone spoof their IP via X-Forwarded-For.
  if (/^true$/i.test(value)) return 1;
  return value; // e.g. "loopback" or a comma separated list of subnets
}

const port = Number(env.PORT) || 3000;
const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '');

let sessionSecret = env.SESSION_SECRET || '';
if (sessionSecret.length < 32) {
  if (isProd) {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters in production.');
  }
  sessionSecret = crypto.randomBytes(48).toString('hex');
  console.warn('[config] SESSION_SECRET is not set - using a temporary secret. Everyone is logged out on restart.');
}

// Live payments by default on the production server, test payments everywhere else.
// PAYFAST_MERCHANT_* hold the live account; PAYFAST_SANDBOX_MERCHANT_* an optional sandbox account.
const sandbox = bool(env.PAYFAST_SANDBOX, !isProd);

// PayFast's shared public sandbox merchant, used only in sandbox mode when no sandbox credentials are set.
// Its passphrase is unknown (anyone can change it), so checkout requests to it are sent unsigned.
// For full end-to-end testing create your own free account at https://sandbox.payfast.co.za.
const SANDBOX_DEFAULTS = { merchantId: '10000100', merchantKey: '46f0cd694581a' };
const publicSandbox = sandbox && !env.PAYFAST_SANDBOX_MERCHANT_ID;

const credentials = sandbox
  ? {
      merchantId: env.PAYFAST_SANDBOX_MERCHANT_ID,
      merchantKey: env.PAYFAST_SANDBOX_MERCHANT_KEY,
      passphrase: env.PAYFAST_SANDBOX_PASSPHRASE,
    }
  : { merchantId: env.PAYFAST_MERCHANT_ID, merchantKey: env.PAYFAST_MERCHANT_KEY, passphrase: env.PAYFAST_PASSPHRASE };

const payfast = {
  sandbox,
  publicSandbox,
  merchantId: publicSandbox ? SANDBOX_DEFAULTS.merchantId : (credentials.merchantId || '').trim(),
  merchantKey: publicSandbox ? SANDBOX_DEFAULTS.merchantKey : (credentials.merchantKey || '').trim(),
  passphrase: publicSandbox ? '' : credentials.passphrase || '',
  signCheckout: !publicSandbox,
  host: sandbox ? 'sandbox.payfast.co.za' : 'www.payfast.co.za',
};

if (publicSandbox) {
  console.warn(
    "[config] PayFast test mode, using PayFast's shared sandbox merchant. Test checkouts work, but automatic " +
      'payment confirmation needs your own sandbox credentials in .env (see README).'
  );
} else if (sandbox) {
  console.warn('[config] PayFast test mode (sandbox). No real money is collected.');
}

if (!sandbox && (!payfast.merchantId || !payfast.merchantKey)) {
  throw new Error('PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY are required for live payments (PAYFAST_SANDBOX=false).');
}
// PayFast confirms each payment by calling PUBLIC_URL/payfast/notify. On localhost or plain http that call never
// arrives, so clients would be charged while the dashboard still shows them as unpaid. Refuse to start instead.
if (!sandbox && (!publicUrl.startsWith('https://') || /^https:\/\/(localhost|127\.|\[::1\])/i.test(publicUrl))) {
  throw new Error(
    'Live PayFast payments need PUBLIC_URL set to the public https:// address of the site (e.g. https://jefitness.co.za). ' +
      'Set PAYFAST_SANDBOX=true to test on this computer.'
  );
}
if (!sandbox && !payfast.passphrase) {
  console.warn('[config] PAYFAST_PASSPHRASE is empty. Set a passphrase in your PayFast dashboard for stronger signatures.');
}
if (isProd && sandbox) {
  console.warn('[config] Running in production with PAYFAST_SANDBOX=true - no real money will be collected.');
}
if (isProd && !publicUrl.startsWith('https://')) {
  console.warn('[config] PUBLIC_URL should be an https:// address in production.');
}

module.exports = {
  ROOT,
  isProd,
  port,
  host: env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1'),
  publicUrl,
  secureCookies: publicUrl.startsWith('https://'),
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  dbPath: path.resolve(ROOT, env.DB_PATH || 'data/je-fitness.sqlite'),
  sessionSecret,
  payfast,
};
