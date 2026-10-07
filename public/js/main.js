/* Site-wide behaviour: navigation, smooth scrolling, scroll-driven reveals and micro-interactions. */
(() => {
  'use strict';

  const root = document.documentElement;
  const body = document.body;
  const isSite = body.classList.contains('is-site');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;

  // ------------------------------------------------------------ flash messages

  document.querySelectorAll('[data-flash]').forEach((el) => {
    const close = () => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 350);
    };
    el.querySelector('[data-flash-close]')?.addEventListener('click', close);
    if (!el.classList.contains('flash-error')) setTimeout(close, 7000);
  });

  // ------------------------------------------------------------ smooth scroll (Lenis)

  let lenis = null;
  if (isSite && !reduceMotion && window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 1, smoothWheel: true });
    if (gsap && ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (t) => {
        lenis.raf(t);
        requestAnimationFrame(raf);
      };
      requestAnimationFrame(raf);
    }
  } else if (gsap && ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
  }

  // Links to a section on the current page (#contact, /packages#online) glide instead of jumping.
  if (isSite) {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href*="#"]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.hash.length < 2) return;
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!target) return;
      e.preventDefault();
      closeMenu();
      if (lenis) lenis.scrollTo(target, { offset: -70, duration: 1.4 });
      else target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      history.replaceState(null, '', url.hash);
    });
  }

  // ------------------------------------------------------------ header

  const header = document.querySelector('[data-header]');
  if (header) {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      header.classList.toggle('is-scrolled', y > 24);
      const menuOpen = body.classList.contains('menu-open');
      header.classList.toggle('is-hidden', !menuOpen && y > 400 && y > lastY + 4);
      if (y < lastY - 4 || y < 400) header.classList.remove('is-hidden');
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ------------------------------------------------------------ mobile menu

  const toggle = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-mobile-menu]');

  function setMenu(open) {
    if (!toggle || !menu) return;
    toggle.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    body.classList.toggle('menu-open', open);
    if (lenis) open ? lenis.stop() : lenis.start();
    if (open) menu.querySelector('a')?.focus();
  }
  function closeMenu() {
    if (toggle && toggle.getAttribute('aria-expanded') === 'true') setMenu(false);
  }
  toggle?.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  menu?.addEventListener('click', (e) => {
    if (e.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      toggle.focus();
    }
  });
  matchMedia('(min-width: 961px)').addEventListener('change', (e) => e.matches && closeMenu());

  // ------------------------------------------------------------ certificate viewer
  // Without JavaScript (or <dialog> support) the link simply opens the image.

  const certDialog = document.querySelector('[data-cert-dialog]');
  if (certDialog && typeof certDialog.showModal === 'function') {
    let opener = null;
    document.querySelectorAll('[data-cert-open]').forEach((link) => {
      link.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        opener = link;
        certDialog.showModal();
        lenis?.stop();
      });
    });
    // A click on the dark backdrop (outside the certificate) closes it.
    certDialog.addEventListener('click', (e) => {
      if (e.target === certDialog) certDialog.close();
    });
    certDialog.addEventListener('close', () => {
      lenis?.start();
      opener?.focus();
    });
  }

  // ------------------------------------------------------------ split headings into words

  function splitWords(el) {
    const label = el.textContent.replace(/\s+/g, ' ').trim();
    const walk = (node) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const parts = child.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          parts.forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              frag.appendChild(document.createTextNode(' '));
              return;
            }
            const w = document.createElement('span');
            w.className = 'w';
            const wi = document.createElement('span');
            wi.className = 'wi';
            wi.textContent = part;
            w.appendChild(wi);
            frag.appendChild(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      });
    };
    walk(el);
    el.setAttribute('aria-label', label);
    el.querySelectorAll('.w').forEach((w) => w.setAttribute('aria-hidden', 'true'));
    return el.querySelectorAll('.wi');
  }

  // ------------------------------------------------------------ reveal animations

  if (gsap && !reduceMotion && root.classList.contains('motion')) {
    root.classList.add('motion-ready');
    const ease = 'expo.out';
    const inView = (el) => el.getBoundingClientRect().top < window.innerHeight * 0.92;

    // Intro: everything visible on first paint animates in as one choreographed sequence.
    const intro = gsap.timeline({ delay: 0.15 });
    const introEls = [...document.querySelectorAll('[data-intro], [data-split], [data-reveal]')].filter(
      (el) => el.hasAttribute('data-intro') || inView(el)
    );
    introEls.forEach((el, i) => {
      const at = i === 0 ? 0 : '<0.08';
      if (el.hasAttribute('data-split')) {
        const words = splitWords(el);
        gsap.set(el, { opacity: 1 });
        intro.fromTo(words, { yPercent: 115, rotate: 4 }, { yPercent: 0, rotate: 0, duration: 1.3, ease, stagger: 0.06, clearProps: 'all' }, at);
      } else {
        intro.fromTo(el, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1.2, ease }, at);
      }
      el.dataset.done = '1';
    });

    if (ScrollTrigger) {
      document.querySelectorAll('[data-split]:not([data-done])').forEach((el) => {
        const words = splitWords(el);
        gsap.set(el, { opacity: 1 });
        gsap.fromTo(words, { yPercent: 115, rotate: 4 }, {
          yPercent: 0, rotate: 0, duration: 1.3, ease, stagger: 0.06, clearProps: 'all',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
      });

      document.querySelectorAll('[data-reveal]:not([data-done])').forEach((el) => {
        gsap.fromTo(el, { opacity: 0, y: 40 }, {
          opacity: 1, y: 0, duration: 1.3, ease,
          scrollTrigger: { trigger: el, start: 'top 90%', once: true },
        });
      });

      document.querySelectorAll('[data-stagger]').forEach((group) => {
        gsap.fromTo(group.children, { opacity: 0, y: 50 }, {
          opacity: 1, y: 0, duration: 1.2, ease, stagger: 0.09,
          scrollTrigger: { trigger: group, start: 'top 88%', once: true },
          clearProps: 'transform',
        });
      });

      // Hero copy drifts and fades as you scroll past it.
      const heroCopy = document.querySelector('.hero-copy');
      if (heroCopy) {
        gsap.to(heroCopy, {
          yPercent: -14, opacity: 0.2, ease: 'none',
          scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
        });
      }
      // Marquee nudges with scroll velocity for a tactile feel.
      const track = document.querySelector('.marquee-track');
      if (track) {
        gsap.to(track, {
          xPercent: -8, ease: 'none',
          scrollTrigger: { trigger: '.marquee', start: 'top bottom', end: 'bottom top', scrub: 1 },
        });
      }
    } else {
      document.querySelectorAll('[data-split]:not([data-done])').forEach((el) => gsap.set(el, { opacity: 1 }));
      gsap.set('[data-reveal], [data-stagger] > *', { opacity: 1 });
    }
  } else {
    root.classList.remove('motion');
  }

  if (reduceMotion || !finePointer) return;

  // ------------------------------------------------------------ 3D tilt + glare on package cards

  document.querySelectorAll('[data-tilt]').forEach((card) => {
    let frame = 0;
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        card.style.transform = `perspective(1100px) rotateX(${(0.5 - py) * 7}deg) rotateY(${(px - 0.5) * 9}deg) translateY(-6px)`;
        card.style.setProperty('--gx', `${px * 100}%`);
        card.style.setProperty('--gy', `${py * 100}%`);
      });
    });
    card.addEventListener('pointerleave', () => {
      cancelAnimationFrame(frame);
      card.style.transform = '';
    });
  });

  // ------------------------------------------------------------ magnetic buttons

  document.querySelectorAll('[data-magnetic]').forEach((btn) => {
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2;
      const y = e.clientY - r.top - r.height / 2;
      btn.style.transform = `translate(${x * 0.18}px, ${y * 0.28}px)`;
    });
    btn.addEventListener('pointerleave', () => {
      btn.style.transform = '';
    });
  });

  // ------------------------------------------------------------ soft gold light that follows the cursor

  if (isSite) {
    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    glow.setAttribute('aria-hidden', 'true');
    body.appendChild(glow);
    let tx = 0, ty = 0, cx = 0, cy = 0, running = false;
    const step = () => {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      glow.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      if (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5) requestAnimationFrame(step);
      else running = false;
    };
    window.addEventListener('pointermove', (e) => {
      tx = e.clientX;
      ty = e.clientY;
      glow.classList.add('is-on');
      if (!running) {
        running = true;
        requestAnimationFrame(step);
      }
    }, { passive: true });
    document.addEventListener('pointerleave', () => glow.classList.remove('is-on'));
  }
})();
