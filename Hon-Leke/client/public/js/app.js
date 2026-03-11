// client/public/js/app.js — Shared utilities

const API = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async post(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  }
};

document.addEventListener('DOMContentLoaded', function () {

  // Sticky header
  (function initHeader() {
    const header = document.getElementById('header');
    if (!header) return;
    window.addEventListener('scroll', () =>
      header.classList.toggle('sticked', window.scrollY > 80)
    );
  })();

  // Mobile nav drawer
  (function initMobileNav() {
    const toggle = document.querySelector('.mobile-nav-toggle');
    const nav    = document.querySelector('.navbar');
    if (!toggle || !nav) return;

    let overlay = document.getElementById('nav-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'nav-overlay';
      overlay.className = 'nav-overlay';
      document.body.appendChild(overlay);
    }

    function injectNavSocial() {
      if (nav.querySelector('.nav-social')) return;
      const headerSocial = document.querySelector('.header-social');
      if (!headerSocial) return;
      const socialDiv = document.createElement('div');
      socialDiv.className = 'nav-social';
      socialDiv.innerHTML = headerSocial.innerHTML;
      nav.appendChild(socialDiv);
    }

    function openNav() {
      nav.classList.add('open');
      overlay.classList.add('open');
      toggle.innerHTML = '<i class="bi bi-x-lg"></i>';
      document.body.style.overflow = 'hidden';
      injectNavSocial();
      // bind close to any links injected after open
      nav.querySelectorAll('a').forEach(a => {
        a.removeEventListener('click', closeNav);
        a.addEventListener('click', closeNav);
      });
    }

    function closeNav() {
      nav.classList.remove('open');
      overlay.classList.remove('open');
      toggle.innerHTML = '<i class="bi bi-list"></i>';
      document.body.style.overflow = '';
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent event bubbling to document
      nav.classList.contains('open') ? closeNav() : openNav();
    });

    overlay.addEventListener('click', closeNav);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeNav();
    });
  })();

  // Search overlay
  (function initSearch() {
    const btn      = document.querySelector('.search-toggle');
    const overlay  = document.querySelector('.search-overlay');
    const closeBtn = document.querySelector('.search-close');
    if (!btn || !overlay) return;
    btn.addEventListener('click', () => overlay.classList.toggle('open'));
    closeBtn?.addEventListener('click', () => overlay.classList.remove('open'));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') overlay.classList.remove('open');
    });
  })();

  // Scroll to top
  (function initScrollTop() {
    const btn = document.querySelector('.scroll-top');
    if (!btn) return;
    window.addEventListener('scroll', () =>
      btn.classList.toggle('visible', window.scrollY > 300)
    );
    btn.addEventListener('click', e => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  })();

});

// Alert helper (global, outside DOMContentLoaded)
function showAlert(el, type, msg) {
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
  setTimeout(() => el.classList.remove('show'), 6000);
}