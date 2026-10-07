'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// Load src/config.js in a fresh process. Every variable is set explicitly (empty counts) so values in .env never leak in.
function loadConfig(vars) {
  const env = {
    ...process.env,
    NODE_ENV: '',
    PUBLIC_URL: '',
    RENDER_EXTERNAL_URL: '',
    SESSION_SECRET: 'x'.repeat(48),
    PAYFAST_SANDBOX: '',
    PAYFAST_MERCHANT_ID: 'LIVE-ID',
    PAYFAST_MERCHANT_KEY: 'live-key',
    PAYFAST_PASSPHRASE: '',
    PAYFAST_SANDBOX_MERCHANT_ID: '',
    PAYFAST_SANDBOX_MERCHANT_KEY: '',
    PAYFAST_SANDBOX_PASSPHRASE: '',
    ...vars,
  };
  const child = spawnSync(process.execPath, ['-e', "const c = require('./src/config'); process.stdout.write(JSON.stringify({ payfast: c.payfast, publicUrl: c.publicUrl }))"], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  return child.status === 0 ? JSON.parse(child.stdout) : { error: child.stderr };
}

test('test payments on a development machine, even with live details saved', () => {
  const { payfast } = loadConfig({});
  assert.equal(payfast.sandbox, true);
  assert.equal(payfast.host, 'sandbox.payfast.co.za');
  assert.notEqual(payfast.merchantId, 'LIVE-ID');
});

test('a sandbox account is used for test payments when one is set', () => {
  const { payfast } = loadConfig({ PAYFAST_SANDBOX_MERCHANT_ID: 'SB-ID', PAYFAST_SANDBOX_MERCHANT_KEY: 'sb-key' });
  assert.equal(payfast.publicSandbox, false);
  assert.equal(payfast.merchantId, 'SB-ID');
  assert.equal(payfast.signCheckout, true);
});

test('live payments with the live account in production', () => {
  const { payfast } = loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://jefitness.co.za' });
  assert.equal(payfast.sandbox, false);
  assert.equal(payfast.host, 'www.payfast.co.za');
  assert.equal(payfast.merchantId, 'LIVE-ID');
  assert.equal(payfast.merchantKey, 'live-key');
});

test('PAYFAST_SANDBOX=true keeps a production server in test mode', () => {
  const { payfast } = loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://jefitness.co.za', PAYFAST_SANDBOX: 'true' });
  assert.equal(payfast.sandbox, true);
});

test('live payments refuse to start without a public https address', () => {
  for (const url of ['', 'http://jefitness.co.za', 'https://localhost:3000']) {
    const { error } = loadConfig({ PAYFAST_SANDBOX: 'false', PUBLIC_URL: url });
    assert.match(error || '', /PUBLIC_URL/, `PUBLIC_URL=${url || '(empty)'}`);
  }
});

test('live payments refuse to start without merchant details', () => {
  const { error } = loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://jefitness.co.za', PAYFAST_MERCHANT_KEY: '' });
  assert.match(error || '', /PAYFAST_MERCHANT_KEY/);
});

test('on Render the site uses its onrender.com address unless PUBLIC_URL is set', () => {
  const render = { NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://je-fitness.onrender.com' };
  const onRender = loadConfig(render);
  assert.equal(onRender.publicUrl, 'https://je-fitness.onrender.com');
  assert.equal(onRender.payfast.sandbox, false);
  assert.equal(loadConfig({ ...render, PUBLIC_URL: 'https://jefitness.co.za/' }).publicUrl, 'https://jefitness.co.za');
});

test('with DB_REQUIRE_DISK the site refuses to start until the disk folder exists', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const disk = fs.mkdtempSync(path.join(os.tmpdir(), 'je-disk-'));
  const open = (dbPath) =>
    spawnSync(process.execPath, ['-e', "require('./src/db').db.close()"], {
      cwd: ROOT,
      env: { ...process.env, PUBLIC_URL: '', NODE_ENV: '', DB_REQUIRE_DISK: '1', DB_PATH: dbPath },
      encoding: 'utf8',
    });
  try {
    const missing = open(path.join(disk, 'not-mounted', 'je-fitness.sqlite'));
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Attach the persistent disk/);
    assert.equal(open(path.join(disk, 'je-fitness.sqlite')).status, 0);
  } finally {
    fs.rmSync(disk, { recursive: true, force: true });
  }
});
