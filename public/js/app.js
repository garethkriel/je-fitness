/* Dashboard: tabs, sidebar, copy-to-clipboard and package price hints. */
(() => {
  'use strict';

  // ------------------------------------------------------------ tabs (deep-linkable via #hash)

  const tabList = document.querySelector('[data-tabs]');
  if (tabList) {
    const tabs = [...tabList.querySelectorAll('[data-tab]')];
    const panels = tabs.map((t) => document.getElementById(t.dataset.tab)).filter(Boolean);
    const ids = tabs.map((t) => t.dataset.tab);
    panels[0]?.parentElement.classList.add('js-tabs');

    const activate = (id, { focus = false, push = true } = {}) => {
      if (!ids.includes(id)) id = ids[0];
      tabs.forEach((t) => {
        const on = t.dataset.tab === id;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      panels.forEach((p) => p.classList.toggle('is-active', p.id === id));
      if (push) history.replaceState(null, '', `${location.pathname}${location.search}#${id}`);
    };

    tabList.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      e.preventDefault();
      activate(tab.dataset.tab);
    });
    tabList.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i === -1) return;
      const keys = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      activate(tabs[keys[e.key]].dataset.tab, { focus: true });
    });
    window.addEventListener('hashchange', () => activate(location.hash.slice(1), { push: false }));
    activate(location.hash.slice(1) || ids[0], { push: false });
  }

  // ------------------------------------------------------------ sidebar on small screens

  const sidebar = document.querySelector('[data-sidebar]');
  const sideToggle = document.querySelector('[data-sidebar-toggle]');
  if (sidebar && sideToggle) {
    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
    const set = (open) => {
      sidebar.classList.toggle('is-open', open);
      backdrop.classList.toggle('is-open', open);
      sideToggle.setAttribute('aria-expanded', String(open));
      if (open) sidebar.querySelector('a')?.focus();
    };
    sideToggle.addEventListener('click', () => set(!sidebar.classList.contains('is-open')));
    backdrop.addEventListener('click', () => set(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
        set(false);
        sideToggle.focus();
      }
    });
  }

  // ------------------------------------------------------------ copy to clipboard

  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const tmp = document.createElement('textarea');
      tmp.value = text;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      tmp.remove();
    }
    const original = btn.innerHTML;
    btn.textContent = 'Copied';
    setTimeout(() => (btn.innerHTML = original), 1800);
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy], [data-copy-text]');
    if (!btn) return;
    const text = btn.dataset.copyText ?? btn.parentElement.querySelector('[data-copy-source]')?.value;
    if (text) copy(text, btn);
  });

  // ------------------------------------------------------------ show the package price as the default amount

  document.querySelectorAll('[data-price-form]').forEach((form) => {
    const select = form.querySelector('[data-package-select]');
    const amount = form.querySelector('[data-amount-input]');
    if (!select || !amount) return;
    const sync = () => {
      const price = select.selectedOptions[0]?.dataset.price;
      amount.placeholder = price ? Number(price).toLocaleString('en-ZA') : '';
    };
    select.addEventListener('change', sync);
    sync();
  });
})();
