/* ============================================================
   app.js — Hon. Leke Abejide Blog
   Global utilities: API, mobile nav, sticky header, scroll top,
   lazy images, cookie consent, skeleton helpers
   ============================================================ */

/* ── Theme: apply before paint to avoid flash of wrong theme ── */
(function () {
  var saved =
    localStorage.getItem('theme') ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light');
  document.documentElement.setAttribute('data-theme', saved);
})();

/* ── API Helper ── */
const API = {
  async get(url) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async postForm(url, formData) {
    const res = await fetch(url, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};

/* ── Global Lazy Image Observer ─────────────────────────────────
   Any <img data-src="..."> anywhere on the page will be observed
   automatically once the DOM is ready.
   ────────────────────────────────────────────────────────────── */
const LazyLoader = (function () {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        if (el.dataset.src) {
          el.src = el.dataset.src;
          el.removeAttribute('data-src');
          el.addEventListener('load', () => el.classList.remove('skeleton'), { once: true });
          el.addEventListener('error', () => el.classList.remove('skeleton'), { once: true });
        }
        if (el.dataset.bgSrc) {
          el.style.backgroundImage = "url('" + el.dataset.bgSrc + "')";
          el.removeAttribute('data-bg-src');
        }
        observer.unobserve(el);
      });
    },
    { rootMargin: '200px' }
  );

  function observe(root) {
    const target = root || document;
    target.querySelectorAll('img[data-src], [data-bg-src]').forEach((el) => observer.observe(el));
  }

  return { observe, observer };
})();

/* ── Cookie Consent Banner ───────────────────────────────────────
   Works site-wide; banner HTML must exist on the page.
   ────────────────────────────────────────────────────────────── */
function initCookieBanner() {
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;

  const COOKIE_KEY = 'leke_cookie_consent';
  if (!localStorage.getItem(COOKIE_KEY)) {
    setTimeout(() => banner.classList.add('show'), 1200);
  }

  const acceptBtn  = document.getElementById('cookie-accept');
  const declineBtn = document.getElementById('cookie-decline');

  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      localStorage.setItem(COOKIE_KEY, 'accepted');
      banner.classList.remove('show');
    });
  }
  if (declineBtn) {
    declineBtn.addEventListener('click', () => {
      localStorage.setItem(COOKIE_KEY, 'declined');
      banner.classList.remove('show');
    });
  }
}

/* ── DOMContentLoaded — all interactive setup ────────────────── */
document.addEventListener('DOMContentLoaded', function () {

  /* ── Dark Mode ── */
  (function initTheme() {
    const saved =
      localStorage.getItem('theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', saved);
  })();

  const themeToggle = document.querySelector('.theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      const current = document.documentElement.getAttribute('data-theme');
      const next    = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    });
  }

  /* ── Mobile Nav ──────────────────────────────────────────────
     Requires: #navbar, #nav-overlay, .mobile-nav-toggle
     These IDs are present on ALL pages including /post/:id
     ─────────────────────────────────────────────────────────── */
  const navbar    = document.getElementById('navbar');
  const overlay   = document.getElementById('nav-overlay');
  const toggleBtn = document.querySelector('.mobile-nav-toggle');

  function openNav() {
    if (!navbar || !overlay || !toggleBtn) return;
    navbar.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    toggleBtn.innerHTML = '<i class="bi bi-x"></i>';
    toggleBtn.setAttribute('aria-expanded', 'true');
  }

  function closeNav() {
    if (!navbar || !overlay || !toggleBtn) return;
    navbar.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    toggleBtn.innerHTML = '<i class="bi bi-list"></i>';
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      navbar && navbar.classList.contains('open') ? closeNav() : openNav();
    });
  }

  if (overlay) {
    overlay.addEventListener('click', closeNav);
  }

  /* Close drawer when a nav link is tapped (mobile UX) */
  document.querySelectorAll('#nav-links a').forEach(function (a) {
    a.addEventListener('click', closeNav);
  });

  /* Close on Escape */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeNav();
      const so = document.querySelector('.search-overlay');
      if (so) so.classList.remove('open');
    }
  });

  /* ── Search overlay ── */
  const searchToggle  = document.querySelector('.search-toggle');
  const searchOverlay = document.querySelector('.search-overlay');
  const searchClose   = document.querySelector('.search-close');

  if (searchToggle && searchOverlay) {
    searchToggle.addEventListener('click', function () {
      searchOverlay.classList.toggle('open');
      if (searchOverlay.classList.contains('open')) {
        const inp = searchOverlay.querySelector('input');
        if (inp) inp.focus();
      }
    });
  }
  if (searchClose && searchOverlay) {
    searchClose.addEventListener('click', function () {
      searchOverlay.classList.remove('open');
    });
  }

  /* ── Sticky header ── */
  const header = document.getElementById('header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('sticked', window.scrollY > 80);
    }, { passive: true });
  }

  /* ── Scroll-to-top button ── */
  const scrollTopBtn = document.querySelector('.scroll-top');
  if (scrollTopBtn) {
    window.addEventListener('scroll', function () {
      scrollTopBtn.classList.toggle('visible', window.scrollY > 320);
    }, { passive: true });
    scrollTopBtn.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── Activate lazy loading on current DOM ── */
  LazyLoader.observe(document);

  /* ── Cookie banner ── */
  initCookieBanner();
});