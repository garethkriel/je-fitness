'use strict';
// Small form validator: collects cleaned values in `data` and per-field messages in `errors`.

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

class Validator {
  constructor(body) {
    this.body = body || {};
    this.data = {};
    this.errors = {};
  }

  get ok() {
    return Object.keys(this.errors).length === 0;
  }

  raw(name) {
    const v = this.body[name];
    if (Array.isArray(v)) return v.length ? String(v[v.length - 1]) : '';
    return v === undefined || v === null ? '' : String(v);
  }

  fail(name, message) {
    if (!this.errors[name]) this.errors[name] = message;
  }

  text(name, { label = 'This field', required = false, max = 200, min = 0, multiline = false } = {}) {
    let v = this.raw(name).replace(/\r\n/g, '\n');
    // Strip control characters (keep newlines and tabs in multi-line fields).
    v = multiline ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') : v.replace(/[\u0000-\u001F\u007F]/g, ' ');
    v = v.trim();
    if (!v) {
      if (required) this.fail(name, `${label} is required.`);
      this.data[name] = '';
      return this;
    }
    if (v.length < min) this.fail(name, `${label} must be at least ${min} characters.`);
    if (v.length > max) this.fail(name, `${label} must be ${max} characters or fewer.`);
    this.data[name] = v.slice(0, max);
    return this;
  }

  email(name, { required = true } = {}) {
    const v = this.raw(name).trim().toLowerCase();
    if (!v) {
      if (required) this.fail(name, 'Email address is required.');
    } else if (v.length > 254 || !EMAIL_RE.test(v)) {
      this.fail(name, 'Enter a valid email address.');
    }
    this.data[name] = v;
    return this;
  }

  phone(name, { label = 'Phone number', required = false } = {}) {
    const compact = this.raw(name).replace(/[\s()-]/g, '');
    if (!compact) {
      if (required) this.fail(name, `${label} is required.`);
      this.data[name] = '';
      return this;
    }
    let local = compact;
    if (/^\+27\d{9}$/.test(compact)) local = '0' + compact.slice(3);
    else if (/^27\d{9}$/.test(compact)) local = '0' + compact.slice(2);
    if (!/^0\d{9}$/.test(local)) this.fail(name, `${label} should be a South African number, e.g. 081 234 5678.`);
    this.data[name] = local;
    return this;
  }

  number(name, { label = 'This field', required = false, min = -Infinity, max = Infinity, integer = false } = {}) {
    const s = this.raw(name).trim().replace(',', '.');
    if (!s) {
      if (required) this.fail(name, `${label} is required.`);
      this.data[name] = null;
      return this;
    }
    const n = Number(s);
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
      this.fail(name, `${label} must be a ${integer ? 'whole ' : ''}number.`);
      this.data[name] = null;
    } else if (n < min || n > max) {
      this.fail(name, `${label} must be between ${min} and ${max}.`);
      this.data[name] = null;
    } else {
      this.data[name] = n;
    }
    return this;
  }

  date(name, { label = 'Date', required = false } = {}) {
    const s = this.raw(name).trim();
    if (!s) {
      if (required) this.fail(name, `${label} is required.`);
      this.data[name] = '';
      return this;
    }
    const d = new Date(`${s}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      this.fail(name, `Enter a valid ${label.toLowerCase()}.`);
    }
    this.data[name] = s;
    return this;
  }

  oneOf(name, options, { label = 'This field', required = false } = {}) {
    const v = this.raw(name).trim();
    if (!v) {
      if (required) this.fail(name, `Choose ${label.toLowerCase()}.`);
      this.data[name] = '';
    } else if (!options.includes(v)) {
      this.fail(name, `Choose a valid ${label.toLowerCase()}.`);
      this.data[name] = '';
    } else {
      this.data[name] = v;
    }
    return this;
  }

  checked(name, { message } = {}) {
    const v = this.raw(name);
    const on = v === 'on' || v === '1' || v === 'true' || v === 'yes';
    if (message && !on) this.fail(name, message);
    this.data[name] = on;
    return this;
  }
}

function list(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function ageOn(dobIso, today = new Date()) {
  const dob = new Date(`${dobIso}T00:00:00Z`);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

module.exports = { Validator, list, ageOn };
