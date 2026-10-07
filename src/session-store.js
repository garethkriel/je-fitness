'use strict';
const session = require('express-session');

// express-session store backed by the app's SQLite database, so logins survive restarts
// without the memory leak of the default MemoryStore.
class SqliteSessionStore extends session.Store {
  constructor(db, { fallbackTtlMs = 12 * 60 * 60 * 1000 } = {}) {
    super();
    this.fallbackTtlMs = fallbackTtlMs;
    this.getStmt = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?');
    this.setStmt = db.prepare(`
      INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
    `);
    this.destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this.pruneStmt = db.prepare('DELETE FROM sessions WHERE expires < ?');
    this.timer = setInterval(() => this.pruneStmt.run(Date.now()), 15 * 60 * 1000);
    this.timer.unref();
  }

  expiry(sess) {
    const expires = sess && sess.cookie && sess.cookie.expires;
    return expires ? new Date(expires).getTime() : Date.now() + this.fallbackTtlMs;
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.setStmt.run(sid, JSON.stringify(sess), this.expiry(sess));
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.destroyStmt.run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.touchStmt.run(this.expiry(sess), sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
}

module.exports = SqliteSessionStore;
