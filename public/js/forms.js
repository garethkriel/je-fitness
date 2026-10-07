/* Form helpers: password visibility, busy states, confirmations, guardian fields, payment status polling. */
(() => {
  'use strict';

  // ------------------------------------------------------------ show / hide password

  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    const input = btn.parentElement.querySelector('input');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', String(show));
    });
  });

  // ------------------------------------------------------------ confirmations & auto-submit

  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
  document.querySelectorAll('[data-autosubmit]').forEach((el) => {
    el.addEventListener('change', () => el.form.requestSubmit());
  });

  // ------------------------------------------------------------ busy state on submit

  document.querySelectorAll('[data-busy-form]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (e.defaultPrevented) return;
      const btn = e.submitter || form.querySelector('[type="submit"]');
      if (!btn || btn.classList.contains('is-busy')) return;
      // Deferred so the browser captures the form data before the button changes.
      setTimeout(() => {
        btn.classList.add('is-busy');
        btn.setAttribute('aria-busy', 'true');
        const spinner = document.createElement('span');
        spinner.className = 'spinner-inline';
        spinner.setAttribute('aria-hidden', 'true');
        btn.prepend(spinner);
      }, 0);
    });
  });
  // Restore buttons when the page comes back from the back/forward cache.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    document.querySelectorAll('.is-busy').forEach((btn) => {
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
      btn.querySelector('.spinner-inline')?.remove();
    });
  });

  // ------------------------------------------------------------ checkout: guardian details for under-18s

  const checkout = document.querySelector('[data-checkout-form]');
  if (checkout) {
    const toggle = checkout.querySelector('[data-under-18]');
    const guardian = checkout.querySelector('[data-guardian]');
    const sync = () => {
      const minor = toggle ? toggle.checked : true;
      guardian.hidden = !minor;
      guardian.querySelectorAll('[data-guardian-required]').forEach((el) => (el.required = minor));
    };
    toggle?.addEventListener('change', () => {
      sync();
      if (toggle.checked) guardian.querySelector('input')?.focus();
    });
    sync();
    document.querySelector('[data-error-summary]')?.focus();
  }

  // ------------------------------------------------------------ waiting for PayFast to confirm a payment

  const statusBox = document.querySelector('[data-payment-status]');
  if (statusBox && statusBox.dataset.status !== 'paid') {
    const token = statusBox.dataset.token;
    const live = statusBox.querySelector('[data-status-live]');
    let tries = 0;
    const poll = async () => {
      tries++;
      try {
        const res = await fetch(`/pay/${encodeURIComponent(token)}/status`, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const { status } = await res.json();
          if (status === 'paid') {
            statusBox.querySelector('[data-state="waiting"]').hidden = true;
            statusBox.querySelector('[data-state="paid"]').hidden = false;
            if (live) live.textContent = 'Payment confirmed.';
            return;
          }
        }
      } catch {
        /* network blip - try again */
      }
      if (tries < 40) setTimeout(poll, tries < 10 ? 3000 : 6000);
    };
    setTimeout(poll, 2000);
  }
})();
