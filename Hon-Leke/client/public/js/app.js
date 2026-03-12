/* ============================================================
   app.js — Hon. Leke Abejide Blog
   Global utilities: API, mobile nav, sticky header, scroll top
   ============================================================ */

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
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async postForm(url, formData) {
    const res = await fetch(url, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
};

/* ── Global Mobile Nav (works on ALL pages) ── */
document.addEventListener('DOMContentLoaded', function () {

  const navbar    = document.getElementById('navbar');
  const overlay   = document.getElementById('nav-overlay');
  const toggleBtn = document.querySelector('.mobile-nav-toggle');
  const searchToggle = document.querySelector('.search-toggle');
  const searchOverlay = document.querySelector('.search-overlay');
  const searchClose   = document.querySelector('.search-close');
  const scrollTopBtn  = document.querySelector('.scroll-top');
  const header        = document.getElementById('header');

  /* --- Nav open/close --- */
  function openNav() {
    if (!navbar || !overlay || !toggleBtn) return;
    navbar.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    toggleBtn.innerHTML = '<i class="bi bi-x"></i>';
  }

  function closeNav() {
    if (!navbar || !overlay || !toggleBtn) return;
    navbar.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    toggleBtn.innerHTML = '<i class="bi bi-list"></i>';
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

  /* Close nav when a link is clicked inside drawer */
  document.querySelectorAll('#nav-links a').forEach(function (a) {
    a.addEventListener('click', closeNav);
  });

  /* Close nav on Escape key */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeNav();
      if (searchOverlay) searchOverlay.classList.remove('open');
    }
  });

  /* --- Search overlay --- */
  if (searchToggle && searchOverlay) {
    searchToggle.addEventListener('click', function () {
      searchOverlay.classList.toggle('open');
      if (searchOverlay.classList.contains('open')) {
        var inp = searchOverlay.querySelector('input');
        if (inp) inp.focus();
      }
    });
  }
  if (searchClose && searchOverlay) {
    searchClose.addEventListener('click', function () {
      searchOverlay.classList.remove('open');
    });
  }

  /* --- Sticky header --- */
  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('sticked', window.scrollY > 80);
    });
  }

  /* --- Scroll top button --- */
  if (scrollTopBtn) {
    window.addEventListener('scroll', function () {
      scrollTopBtn.classList.toggle('visible', window.scrollY > 320);
    });
    scrollTopBtn.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

});