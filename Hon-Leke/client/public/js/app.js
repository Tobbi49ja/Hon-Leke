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

// Sticky header
(function initHeader() {
  const header = document.getElementById('header');
  if (!header) return;
  window.addEventListener('scroll', () => header.classList.toggle('sticked', window.scrollY > 80));
})();

// Mobile nav
(function initMobileNav() {
  const toggle = document.querySelector('.mobile-nav-toggle');
  const nav = document.querySelector('.navbar');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    nav.classList.toggle('open');
    const icon = nav.classList.contains('open') ? 'bi-x-lg' : 'bi-list';
    toggle.innerHTML = `<i class="bi ${icon}"></i>`;
  });
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('open');
    toggle.innerHTML = '<i class="bi bi-list"></i>';
  }));
  // Close on outside click
  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && !toggle.contains(e.target)) {
      nav.classList.remove('open');
      toggle.innerHTML = '<i class="bi bi-list"></i>';
    }
  });
})();

// Search overlay
(function initSearch() {
  const btn = document.querySelector('.search-toggle');
  const overlay = document.querySelector('.search-overlay');
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
  window.addEventListener('scroll', () => btn.classList.toggle('visible', window.scrollY > 300));
  btn.addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
})();

// Alert helper
function showAlert(el, type, msg) {
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
  setTimeout(() => el.classList.remove('show'), 6000);
}
