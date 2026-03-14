/* ============================================================
   app.js — Hon. Leke Abejide Blog
   Global: API, theme, mobile nav, search, sticky header,
   scroll-top, lazy images, cookie consent, blog animations
   ============================================================ */

/* ── Apply saved theme immediately to prevent flash ── */
(() => {
  const saved =
    localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', saved);
})();

/* ================================================================
   API HELPER
   ================================================================ */
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

/* ================================================================
   LAZY IMAGE LOADER
   Usage: LazyLoader.observe(containerElement)
   Any <img data-src="..."> or [data-bg-src="..."] inside the
   container will load when scrolled into view.
   ================================================================ */
const LazyLoader = (() => {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const el = entry.target;

      if (el.dataset.src) {
        el.src = el.dataset.src;
        el.removeAttribute('data-src');
        el.addEventListener('load',  () => el.classList.remove('skeleton'), { once: true });
        el.addEventListener('error', () => el.classList.remove('skeleton'), { once: true });
      }

      if (el.dataset.bgSrc) {
        el.style.backgroundImage = `url('${el.dataset.bgSrc}')`;
        el.removeAttribute('data-bg-src');
      }

      observer.unobserve(el);
    });
  }, { rootMargin: '200px' });

  const observe = (root = document) => {
    root.querySelectorAll('img[data-src], [data-bg-src]').forEach((el) => observer.observe(el));
  };

  return { observe };
})();

/* ================================================================
   COOKIE CONSENT BANNER
   Works on any page that has #cookie-banner in the HTML.
   ================================================================ */
const initCookieBanner = () => {
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;

  const KEY = 'leke_cookie_consent';

  if (!localStorage.getItem(KEY)) {
    setTimeout(() => banner.classList.add('show'), 1200);
  }

  const acceptBtn  = document.getElementById('cookie-accept');
  const declineBtn = document.getElementById('cookie-decline');

  acceptBtn?.addEventListener('click', () => {
    localStorage.setItem(KEY, 'accepted');
    banner.classList.remove('show');
  });

  declineBtn?.addEventListener('click', () => {
    localStorage.setItem(KEY, 'declined');
    banner.classList.remove('show');
  });
};

/* ================================================================
   BLOG CARD ANIMATE-ON-VIEW
   Each card is registered with an IntersectionObserver.
   Cards only animate when they actually scroll into the viewport.
   Cards start at opacity:0 + translateY(40px) via CSS.
   ================================================================ */
const cardObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;

    const card = entry.target;

    /* Calculate stagger index only among siblings not yet shown */
    const siblings = [...card.parentElement.querySelectorAll('.post-card:not(.show)')];
    const index    = siblings.indexOf(card);

    setTimeout(() => card.classList.add('show'), index * 80);

    /* Stop observing — each card animates once */
    cardObserver.unobserve(card);
  });
}, {
  /* Card must be 60px inside the bottom of the viewport before firing */
  rootMargin: '0px 0px -60px 0px',
  threshold:  0.1,
});

const animateBlogCards = () => {
  const grid = document.getElementById('posts-grid');
  if (!grid) return;

  /* Register every card that hasn't been shown yet */
  grid.querySelectorAll('.post-card:not(.show)').forEach((card) => {
    cardObserver.observe(card);
  });
};

/* ================================================================
   DOM CONTENT LOADED
   All interactive wiring — runs on every page
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Dark / Light mode toggle ────────────────────────────── */
  const applySavedTheme = () => {
    const saved =
      localStorage.getItem('theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', saved);
  };
  applySavedTheme();

  const themeToggle = document.querySelector('.theme-toggle');
  themeToggle?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });

  /* ── Mobile nav drawer ───────────────────────────────────────
     Requires on every page:
       #navbar, #nav-overlay, .mobile-nav-toggle
     ─────────────────────────────────────────────────────────── */
  const navbar    = document.getElementById('navbar');
  const overlay   = document.getElementById('nav-overlay');
  const toggleBtn = document.querySelector('.mobile-nav-toggle');

  const openNav = () => {
    if (!navbar || !overlay || !toggleBtn) return;
    navbar.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    toggleBtn.innerHTML = '<i class="bi bi-x"></i>';
    toggleBtn.setAttribute('aria-expanded', 'true');
  };

  const closeNav = () => {
    if (!navbar || !overlay || !toggleBtn) return;
    navbar.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    toggleBtn.innerHTML = '<i class="bi bi-list"></i>';
    toggleBtn.setAttribute('aria-expanded', 'false');
  };

  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    navbar?.classList.contains('open') ? closeNav() : openNav();
  });

  overlay?.addEventListener('click', closeNav);

  /* Close drawer when a nav link is tapped */
  document.querySelectorAll('#nav-links a').forEach((a) => {
    a.addEventListener('click', closeNav);
  });

  /* Close on Escape key */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeNav();
      document.querySelector('.search-overlay')?.classList.remove('open');
    }
  });

  /* ── Search overlay ── */
  const searchToggle  = document.querySelector('.search-toggle');
  const searchOverlay = document.querySelector('.search-overlay');
  const searchClose   = document.querySelector('.search-close');

  searchToggle?.addEventListener('click', () => {
    searchOverlay?.classList.toggle('open');
    if (searchOverlay?.classList.contains('open')) {
      searchOverlay.querySelector('input')?.focus();
    }
  });

  searchClose?.addEventListener('click', () => {
    searchOverlay?.classList.remove('open');
  });

  /* ── Sticky header shadow ── */
  const header = document.getElementById('header');
  if (header) {
    window.addEventListener('scroll', () => {
      header.classList.toggle('sticked', window.scrollY > 80);
    }, { passive: true });
  }

  /* ── Scroll-to-top button ── */
  const scrollTopBtn = document.querySelector('.scroll-top');
  if (scrollTopBtn) {
    window.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('visible', window.scrollY > 320);
    }, { passive: true });

    scrollTopBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── Lazy load images on current page ── */
  LazyLoader.observe(document);

  /* ── Cookie consent banner ── */
  initCookieBanner();

});