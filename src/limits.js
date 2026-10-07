'use strict';
const { rateLimit } = require('express-rate-limit');

function limiter({ minutes, limit, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(req, res) {
      res.status(429).render('error', { title: 'Too many attempts', status: 429, message });
    },
  });
}

module.exports = {
  global: limiter({ minutes: 15, limit: 600, message: 'Too many requests. Please wait a few minutes and try again.' }),
  login: limiter({
    minutes: 15,
    limit: 10,
    skipSuccessfulRequests: true,
    message: 'Too many sign-in attempts from your network. Please wait 15 minutes and try again.',
  }),
  checkout: limiter({ minutes: 60, limit: 20, message: 'Too many checkout attempts. Please try again in an hour.' }),
  enquiry: limiter({ minutes: 60, limit: 5, message: 'You have sent several messages already. Please try again later or email directly.' }),
};
