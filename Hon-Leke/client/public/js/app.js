/* ============================================================
   app.js — Hon. Leke Abejide Blog
   Global: API, theme, mobile nav, search, sticky header,
   scroll-top, lazy images, cookie consent, blog animations,
   reading time, reading progress bar, image lightbox
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
    let res;
    try {
      res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    } catch(e) {
      throw new Error('Network problem. Please check your connection and try again.');
    }
    if (!res.ok) {
      let msg;
      try { const d = await res.json(); msg = d.message; } catch(_) {}
      if (res.status === 404) throw new Error(msg || 'Content not found.');
      if (res.status === 429) throw new Error('Too many requests. Please wait a moment and try again.');
      throw new Error(msg || 'Something went wrong. Please try again.');
    }
    return res.json();
  },
  async post(url, body) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch(e) {
      throw new Error('Network problem. Please check your connection and try again.');
    }
    if (!res.ok) {
      let msg;
      try { const d = await res.json(); msg = d.message; } catch(_) {}
      if (res.status === 429) throw new Error('Too many requests. Please wait a moment and try again.');
      throw new Error(msg || 'Something went wrong. Please try again.');
    }
    return res.json();
  },
  async postForm(url, formData) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', body: formData });
    } catch(e) {
      throw new Error('Network problem. Please check your connection and try again.');
    }
    if (!res.ok) {
      let msg;
      try { const d = await res.json(); msg = d.message; } catch(_) {}
      throw new Error(msg || 'Something went wrong. Please try again.');
    }
    return res.json();
  },
};

/* ================================================================
   READING TIME CALCULATOR
   Usage: calcReadingTime(text) → "5 min read"
   ================================================================ */
function calcReadingTime(text) {
  if (!text) return '1 min read';
  const wordsPerMinute = 200;
  const wordCount = text.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.ceil(wordCount / wordsPerMinute));
  return `${minutes} min read`;
}

/* ================================================================
   READING PROGRESS BAR
   Call initReadingProgress() on single post pages.
   Requires <div id="reading-progress-bar"></div> in the HTML.
   ================================================================ */
function initReadingProgress() {
  const bar = document.getElementById('reading-progress-bar');
  if (!bar) return;

  const updateProgress = () => {
    const scrollTop    = window.scrollY;
    const docHeight    = document.documentElement.scrollHeight - window.innerHeight;
    const progress     = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    bar.style.width    = Math.min(progress, 100) + '%';
  };

  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();
}

/* ================================================================
   IMAGE LIGHTBOX
   Call initLightbox(container) after post content is rendered.
   Clicking any .post-single-img opens a fullscreen overlay.
   ================================================================ */
function initLightbox(container) {
  if (!container) return;

  // Create overlay if it doesn't exist yet
  let overlay = document.getElementById('lightbox-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lightbox-overlay';
    overlay.innerHTML = `
      <button class="lightbox-close" aria-label="Close lightbox"><i class="bi bi-x-lg"></i></button>
      <button class="lightbox-prev"  aria-label="Previous image"><i class="bi bi-chevron-left"></i></button>
      <button class="lightbox-next"  aria-label="Next image"><i class="bi bi-chevron-right"></i></button>
      <div class="lightbox-img-wrap">
        <img class="lightbox-img" src="" alt="">
        <div class="lightbox-caption"></div>
      </div>`;
    document.body.appendChild(overlay);

    // Close on overlay background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeLightbox();
    });
    overlay.querySelector('.lightbox-close').addEventListener('click', closeLightbox);

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!overlay.classList.contains('open')) return;
      if (e.key === 'Escape')      closeLightbox();
      if (e.key === 'ArrowRight')  lightboxNav(1);
      if (e.key === 'ArrowLeft')   lightboxNav(-1);
    });

    overlay.querySelector('.lightbox-prev').addEventListener('click', () => lightboxNav(-1));
    overlay.querySelector('.lightbox-next').addEventListener('click', () => lightboxNav(1));
  }

  // Collect all post images in this container
  const images = [...container.querySelectorAll('.post-single-img, .post-single-content img')];
  if (!images.length) return;

  let currentIndex = 0;

  images.forEach((img, idx) => {
    img.style.cursor = 'zoom-in';
    // Remove pointer-events:none set by the image protection style
    // so lightbox clicks still work — we keep right-click blocked via contextmenu
    img.style.pointerEvents = 'auto';
    img.addEventListener('click', () => {
      currentIndex = idx;
      openLightbox(img.src, img.alt || '');
    });
  });

  function openLightbox(src, caption) {
    const lbImg     = overlay.querySelector('.lightbox-img');
    const lbCaption = overlay.querySelector('.lightbox-caption');
    lbImg.src       = src;
    lbCaption.textContent = caption;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Show/hide nav arrows
    overlay.querySelector('.lightbox-prev').style.display = images.length > 1 ? '' : 'none';
    overlay.querySelector('.lightbox-next').style.display = images.length > 1 ? '' : 'none';
  }

  function closeLightbox() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  function lightboxNav(dir) {
    currentIndex = (currentIndex + dir + images.length) % images.length;
    const img = images[currentIndex];
    overlay.querySelector('.lightbox-img').src = img.src;
    overlay.querySelector('.lightbox-caption').textContent = img.alt || '';
  }

  // Expose globally so post page can call lightboxNav
  window._lightboxNav = lightboxNav;
  window._closeLightbox = closeLightbox;
}

/* ================================================================
   LAZY IMAGE LOADER
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
   ================================================================ */
const initCookieBanner = () => {
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;
  const KEY = 'leke_cookie_consent';
  if (!localStorage.getItem(KEY)) {
    setTimeout(() => banner.classList.add('show'), 1200);
  }
  document.getElementById('cookie-accept')?.addEventListener('click', () => {
    localStorage.setItem(KEY, 'accepted');
    banner.classList.remove('show');
  });
  document.getElementById('cookie-decline')?.addEventListener('click', () => {
    localStorage.setItem(KEY, 'declined');
    banner.classList.remove('show');
  });
};

/* ================================================================
   BLOG CARD ANIMATE-ON-VIEW
   ================================================================ */
const cardObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const card     = entry.target;
    const siblings = [...card.parentElement.querySelectorAll('.post-card:not(.show)')];
    const index    = siblings.indexOf(card);
    setTimeout(() => card.classList.add('show'), index * 80);
    cardObserver.unobserve(card);
  });
}, { rootMargin: '0px 0px -60px 0px', threshold: 0.1 });

const animateBlogCards = () => {
  const grid = document.getElementById('posts-grid');
  if (!grid) return;
  grid.querySelectorAll('.post-card:not(.show)').forEach((card) => {
    cardObserver.observe(card);
  });
};

/* ================================================================
   DOM CONTENT LOADED
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Dark / Light mode ── */
  const applySavedTheme = () => {
    const saved =
      localStorage.getItem('theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', saved);
  };
  applySavedTheme();

  document.querySelector('.theme-toggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });

  /* ── Mobile nav drawer ── */
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
  document.querySelectorAll('#nav-links a').forEach((a) => a.addEventListener('click', closeNav));
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
  searchClose?.addEventListener('click', () => searchOverlay?.classList.remove('open'));

  /* ── Sticky header ── */
  const header = document.getElementById('header');
  if (header) {
    window.addEventListener('scroll', () => {
      header.classList.toggle('sticked', window.scrollY > 80);
    }, { passive: true });
  }

  /* ── Scroll-to-top ── */
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

  /* ── Reading progress bar ── */
  initReadingProgress();

  /* ── Lazy load images ── */
  LazyLoader.observe(document);

  /* ── Cookie consent ── */
  initCookieBanner();

});