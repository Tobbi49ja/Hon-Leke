// server/server.js
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const connectDB = require('./db');
const { seedIfEmpty } = require('./data/store');
const store     = require('./data/store');
const { apiLimiter, contactLimiter, requireAdmin } = require('./middleware/index');
const postsRouter   = require('./routes/posts');
const contactRouter = require('./routes/contact');
const adminRouter   = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 24 * 60 * 60 * 1000 }
}));

// ── Static Files ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'client', 'public')));
app.use('/admin/assets', express.static(path.join(__dirname, '..', 'admin', 'public')));

// ── API Routes ─────────────────────────────────────────────────────────────────
app.use('/api', apiLimiter);
app.use('/api/posts',   postsRouter);
app.use('/api/contact', contactLimiter, contactRouter);
app.use('/api/subscribe', (req, res, next) => {
  req.url = '/subscribe';
  contactRouter(req, res, next);
});
app.use('/api/admin', adminRouter);

// ── Cloudinary helpers (for OG tag injection) ──────────────────────────────────
function signedCloudinaryUrl(publicId, resourceType = 'image', transformation = '') {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;
  const toSign    = (transformation ? transformation + '/' : '') + publicId;
  const rawHash   = crypto.createHash('sha1').update(toSign + apiSecret).digest('base64');
  const signature = rawHash.replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);
  const transformPart = transformation ? `/${transformation}` : '';
  return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/s--${signature}--${transformPart}/${publicId}`;
}

function extractPublicId(url) {
  if (!url) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  return match[1].replace(/\.[^.]+$/, '');
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Client Pages ───────────────────────────────────────────────────────────────
const clientPages = path.join(__dirname, '..', 'client', 'pages');

app.get('/',        (req, res) => res.sendFile(path.join(clientPages, 'home',    'index.html')));
app.get('/about',   (req, res) => res.sendFile(path.join(clientPages, 'about',   'index.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(clientPages, 'contact', 'index.html')));

// ── /post/:id — inject OG tags into HTML before sending ───────────────────────
// WhatsApp, Facebook, Twitter bots don't run JS. They read raw HTML only.
// We intercept this route, look up the post, inject the real OG meta values
// into the static HTML file, then send it. Bots get correct preview data.
// Regular browsers also benefit (title updates instantly without waiting for JS).
app.get('/post/:id', async (req, res) => {
  const htmlPath = path.join(clientPages, 'post', 'index.html');

  try {
    const post = await store.getPostById(req.params.id);

    // If post not found, still serve the page — JS will show the 404 UI
    if (!post) return res.sendFile(htmlPath);

    const siteUrl  = process.env.SITE_URL || `${req.protocol}://${req.headers.host}`;
    const postUrl  = `${siteUrl}/post/${post.id}`;
    const siteName = 'Hon. Leke Abejide';
    const title    = post.title   || siteName;
    const desc     = post.excerpt || 'Read the latest from Hon. Leke Abejide';

    // Build OG image: signed Cloudinary 1200×630, fallback to raw image or favicon
    let ogImage = post.image || `${siteUrl}/favicon.png`;
    if (post.image && process.env.CLOUDINARY_CLOUD_NAME) {
      const publicId = extractPublicId(post.image);
      if (publicId) {
        const signed = signedCloudinaryUrl(publicId, 'image', 'c_fill,w_1200,h_630,q_auto,f_jpg');
        if (signed) ogImage = signed;
      }
    }

    // Read the static HTML, inject real values into the placeholder meta tags
    let html = fs.readFileSync(htmlPath, 'utf8');

    html = html
      .replace(/<title[^>]*>.*?<\/title>/,
        `<title>${escHtml(title)} — ${escHtml(siteName)}</title>`)
      .replace(/(<meta[^>]*id="og-title"[^>]*content=")[^"]*"/,
        `$1${escHtml(title)}"`)
      .replace(/(<meta[^>]*id="og-description"[^>]*content=")[^"]*"/,
        `$1${escHtml(desc)}"`)
      .replace(/(<meta[^>]*id="og-image"[^>]*content=")[^"]*"/,
        `$1${escHtml(ogImage)}"`)
      .replace(/(<meta[^>]*id="og-url"[^>]*content=")[^"]*"/,
        `$1${escHtml(postUrl)}"`)
      .replace(/(<meta[^>]*id="og-site"[^>]*content=")[^"]*"/,
        `$1${escHtml(siteName)}"`)
      .replace(/(<meta[^>]*id="tw-title"[^>]*content=")[^"]*"/,
        `$1${escHtml(title)}"`)
      .replace(/(<meta[^>]*id="tw-description"[^>]*content=")[^"]*"/,
        `$1${escHtml(desc)}"`)
      .replace(/(<meta[^>]*id="tw-image"[^>]*content=")[^"]*"/,
        `$1${escHtml(ogImage)}"`)
      .replace('</head>',
        `  <link rel="canonical" href="${escHtml(postUrl)}">\n</head>`);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (err) {
    console.error('OG injection error for /post/:id:', err);
    // Fall back to plain static file on any error
    res.sendFile(htmlPath);
  }
});

// ── Admin Pages ────────────────────────────────────────────────────────────────
const adminPages = path.join(__dirname, '..', 'admin', 'pages');

app.get('/admin',                     (req, res) => res.redirect('/admin/login'));
app.get('/admin/login',               (req, res) => res.sendFile(path.join(adminPages, 'login.html')));
app.get('/admin/about',     requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'about.html')));
app.get('/admin/dashboard', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'dashboard.html')));
app.get('/admin/posts',     requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'posts.html')));
app.get('/admin/posts/new', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'post-form.html')));
app.get('/admin/posts/edit/:id', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'post-form.html')));
app.get('/admin/comments',  requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'comments.html')));
app.get('/admin/messages',  requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'messages.html')));
app.get('/admin/subscribers', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'subscribers.html')));
app.get('/admin/settings',  requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'settings.html')));

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(clientPages, '404', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────────
async function start() {
  await connectDB();
  await seedIfEmpty();

  app.listen(PORT, () => {
    console.log(`\n✅  Hon. Leke Abejide Blog`);
    console.log(`🌐  Site:  http://localhost:${PORT}`);
    console.log(`🔐  Admin: http://localhost:${PORT}/admin`);
  });
}

start();
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hon. Leke Abejide — Official Blog</title>
  <meta name="description" content="Official blog of Rt. Hon. Leke Abejide, Member House of Representatives, Yagba Federal Constituency.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500&family=Inter:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <link href="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="icon" href="/favicon.png">
  <style>
    /* ── Video card: play overlay icon ── */
    .post-card-video-wrap {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .post-card-video-wrap video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .post-card-video-wrap .play-icon {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.28);
      transition: opacity 0.25s ease;
      pointer-events: none;
    }
    .post-card-video-wrap .play-icon i {
      font-size: 3rem;
      color: #fff;
      opacity: 0.9;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));
    }
    /* Hide play icon while video is playing */
    .post-card-video-wrap.playing .play-icon {
      opacity: 0;
    }
  </style>
</head>
<body>

<div class="nav-overlay" id="nav-overlay"></div>

<!-- Header -->
<header id="header">
  <div class="header-inner">
    <a href="/" class="logo">
      <img src="/Logo.png" alt="Hon. Leke Abejide"
           style="height:28px;width:auto;object-fit:contain;display:block;">
      <span id="site-logo-text">Hon. Leke Abejide</span>
    </a>
    <nav class="navbar" id="navbar">
      <ul id="nav-links">
        <li><a href="/" class="active">Blog</a></li>
        <li><a href="/about">About</a></li>
        <li><a href="/contact">Contact</a></li>
      </ul>
    </nav>
    <div class="header-actions">
      <div class="header-social">
        <a href="#" target="_blank" id="hdr-fb"><i class="bi bi-facebook"></i></a>
        <a href="#" target="_blank" id="hdr-ig"><i class="bi bi-instagram"></i></a>
        <a href="#" target="_blank" id="hdr-tw"><i class="bi bi-twitter-x"></i></a>
      </div>
      <button class="search-toggle" aria-label="Search"><i class="bi bi-search"></i></button>
      <button class="theme-toggle" aria-label="Toggle dark mode">
        <i class="bi bi-moon-fill icon-moon"></i>
        <i class="bi bi-sun-fill icon-sun"></i>
      </button>
      <button class="mobile-nav-toggle" aria-label="Toggle menu"><i class="bi bi-list"></i></button>
    </div>
  </div>
</header>

<!-- Search Overlay -->
<div class="search-overlay">
  <form id="search-form">
    <input type="text" id="search-input" placeholder="Search posts..." autocomplete="off">
    <button type="submit">Search</button>
    <button type="button" class="search-close"><i class="bi bi-x"></i></button>
  </form>
</div>

<main id="main">

  <!-- Hero Slider -->
  <section class="hero-slider-section">
    <div class="container-fluid px-0">
      <div class="swiper sliderFeaturedPosts">
        <div class="swiper-wrapper" id="slider-wrapper">
          <div class="swiper-slide">
            <div class="slider-placeholder"><div class="spinner-lg"></div></div>
          </div>
        </div>
        <div class="swiper-button-next"></div>
        <div class="swiper-button-prev"></div>
        <div class="swiper-pagination"></div>
      </div>
    </div>
  </section>

  <!-- Blog Section -->
  <section class="blog-section">
    <div class="container">
      <div class="blog-section-header">
        <div class="section-tag">Latest Updates</div>
        <h2>From the Blog</h2>
        <p>Stay informed about the latest initiatives, community programs, and legislative updates from Yagba Federal Constituency.</p>
      </div>
      <div class="category-filter-bar" id="category-filters">
        <button class="cat-btn active" data-cat="all">All Posts</button>
      </div>
      <div class="blog-grid" id="posts-grid">
        <div class="loading-posts"><div class="spinner-lg"></div><p>Loading posts...</p></div>
      </div>
      <div id="no-posts" class="no-posts" style="display:none">
        <i class="bi bi-newspaper"></i><p>No posts found.</p>
      </div>
      <div class="load-more-wrap" id="load-more-wrap" style="display:none">
        <button class="btn-load-more" id="load-more-btn">
          Load More Articles <i class="bi bi-chevron-down"></i>
        </button>
      </div>
    </div>
  </section>

</main>

<!-- Footer -->
<footer id="site-footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-brand">
        <h3 id="footer-site-name">Hon. Leke Abejide</h3>
        <p id="footer-about">Rt. Hon. Elder Leke Joseph Abejide — Member, House of Representatives, Yagba Federal Constituency, Kogi State.</p>
      </div>
      <div class="footer-col">
        <h4>Quick Links</h4>
        <ul>
          <li><a href="/">Blog</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Recent Posts</h4>
        <ul class="footer-recent" id="footer-recent-posts"></ul>
      </div>
      <div class="footer-col">
        <h4>Newsletter</h4>
        <p style="font-size:0.85rem;opacity:.8;margin-bottom:12px">Stay updated with the latest news.</p>
        <form id="newsletter-form" class="newsletter-footer-form">
          <input type="email" placeholder="Your email address" required>
          <button type="submit">Subscribe</button>
        </form>
        <div id="newsletter-msg" style="font-size:0.82rem;margin-top:8px"></div>
      </div>
    </div>
    <div class="footer-bottom">
      <span id="footer-copy">© 2024 Hon. Leke Abejide. All Rights Reserved.</span>
      <div class="footer-social">
        <a href="#" target="_blank" id="ft-fb"><i class="bi bi-facebook"></i></a>
        <a href="#" target="_blank" id="ft-ig"><i class="bi bi-instagram"></i></a>
        <a href="#" target="_blank" id="ft-tw"><i class="bi bi-twitter-x"></i></a>
      </div>
    </div>
  </div>
</footer>

<a href="#" class="scroll-top"><i class="bi bi-arrow-up"></i></a>

<script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js"></script>
<script src="/js/app.js"></script>
<script>
document.addEventListener('DOMContentLoaded', async function () {

  function mediaUrl(src) {
    if (!src) return '';
    return src.startsWith('http') ? src : '/' + src;
  }

  /* ── Settings ── */
  try {
    const s = await API.get('/api/admin/settings');
    if (s.success) applySettings(s.settings);
  } catch(e) {}

  function applySettings(settings) {
    ['site-logo-text', 'footer-site-name'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = settings.heroTitle || 'Hon. Leke Abejide';
    });
    const fa = document.getElementById('footer-about');
    if (fa) fa.textContent = settings.footerAbout || '';
    const map = {
      facebookUrl:  ['hdr-fb', 'ft-fb'],
      instagramUrl: ['hdr-ig', 'ft-ig'],
      twitterUrl:   ['hdr-tw', 'ft-tw']
    };
    Object.entries(map).forEach(([key, ids]) => {
      if (settings[key]) ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.href = settings[key];
      });
    });
  }

  /* ── Slider ── */
  async function loadSlider() {
    try {
      const data    = await API.get('/api/posts/slider');
      const wrapper = document.getElementById('slider-wrapper');
      if (!data.slides || !data.slides.length) {
        wrapper.innerHTML = '<div class="swiper-slide"><div class="slider-empty"><i class="bi bi-images"></i><p>No featured posts</p></div></div>';
        return;
      }
      wrapper.innerHTML = data.slides.map(s => `
        <div class="swiper-slide">
          <a href="${s.link}" class="slider-slide-link">
            <div class="slider-bg-blur" style="background-image:url('${mediaUrl(s.image)}')"></div>
            <div class="slider-bg-main" style="background-image:url('${mediaUrl(s.image)}')"></div>
            <div class="slider-overlay">
              <div class="slider-content">
                <span class="slider-badge">Featured</span>
                <h2>${s.title}</h2>
                <span class="slider-read">Read Story <i class="bi bi-arrow-right"></i></span>
              </div>
            </div>
          </a>
        </div>`).join('');
      new Swiper('.sliderFeaturedPosts', {
        loop: data.slides.length > 1,
        autoplay: { delay: 5500, disableOnInteraction: false },
        pagination: { el: '.swiper-pagination', clickable: true },
        navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
        effect: 'fade', fadeEffect: { crossFade: true }
      });
    } catch(e) {
      document.getElementById('slider-wrapper').innerHTML = '';
    }
  }

  /* ── Categories ── */
  async function loadCategories() {
    try {
      const data = await API.get('/api/posts/categories');
      const bar  = document.getElementById('category-filters');
      (data.categories || []).forEach(cat => {
        const btn       = document.createElement('button');
        btn.className   = 'cat-btn';
        btn.dataset.cat = cat.toLowerCase();
        btn.textContent = cat;
        bar.appendChild(btn);
      });
      bar.querySelectorAll('.cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          bar.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          loadPosts(btn.dataset.cat);
        });
      });
    } catch(e) {}
  }

  /* ── Posts ── */
  let allPosts    = [];
  let currentPage = 1;
  const perPage   = 9;

  async function loadPosts(cat = 'all', search = '') {
    const grid    = document.getElementById('posts-grid');
    const noPosts = document.getElementById('no-posts');
    const lmWrap  = document.getElementById('load-more-wrap');
    currentPage           = 1;
    grid.innerHTML        = '<div class="loading-posts"><div class="spinner-lg"></div><p>Loading...</p></div>';
    noPosts.style.display = 'none';
    lmWrap.style.display  = 'none';

    try {
      let url      = '/api/posts';
      const params = [];
      if (cat !== 'all') params.push('category=' + encodeURIComponent(cat));
      if (search)        params.push('search='   + encodeURIComponent(search));
      if (params.length) url += '?' + params.join('&');

      const data = await API.get(url);
      allPosts = data.posts || [];

      if (!allPosts.length) {
        grid.innerHTML = '';
        noPosts.style.display = 'flex';
        return;
      }

      renderPosts(allPosts.slice(0, perPage), grid, true);
      if (allPosts.length > perPage) lmWrap.style.display = 'block';

      /* Footer recent posts */
      const fr = document.getElementById('footer-recent-posts');
      if (fr) fr.innerHTML = allPosts.slice(0, 3).map(p =>
        `<li><a href="/post/${p.id}" class="footer-recent-item">
          ${p.image ? `<img src="${mediaUrl(p.image)}" alt="${p.title}" onerror="this.style.display='none'">` : ''}
          <div>
            <span class="footer-post-date">${p.date}</span>
            <span class="footer-post-title">${p.title.substring(0, 55)}...</span>
          </div>
        </a></li>`).join('');

    } catch(e) {
      grid.innerHTML = '<div class="no-posts"><i class="bi bi-exclamation-circle"></i><p>Failed to load posts.</p></div>';
    }
  }

  /* ── Card HTML ──
     - Image post  → shows image
     - Video post with image → shows image thumbnail + play icon; hovers autoplays video,
                               mouseout pauses and resets to thumbnail
     - Video post no image  → shows dark placeholder + play icon; hover autoplays            */
  function cardHTML(p) {
    let media = '';

    if (p.hasVideo && p.videoSrc) {
      // Video card: thumbnail image (if available) + autoplay-on-hover video
      const thumb = p.image
        ? `<img src="${mediaUrl(p.image)}" alt="${p.title}" class="post-card-img" loading="lazy"
               style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`
        : '';
      media = `
        <div class="post-card-video-wrap" data-video-src="${mediaUrl(p.videoSrc)}">
          ${thumb}
          <video muted playsinline preload="none"
                 style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s">
          </video>
          <div class="play-icon"><i class="bi bi-play-circle-fill"></i></div>
        </div>`;
    } else if (p.image) {
      media = `<img src="${mediaUrl(p.image)}" alt="${p.title}" class="post-card-img" loading="lazy">`;
    } else {
      media = `<div class="post-card-img-placeholder"><i class="bi bi-newspaper"></i></div>`;
    }

    return `
      <article class="post-card" onclick="window.location.href='/post/${p.id}'">
        <div class="post-card-media">
          ${media}
          ${p.featured ? '<span class="featured-badge"><i class="bi bi-star-fill"></i> Featured</span>' : ''}
        </div>
        <div class="post-card-body">
          <span class="post-cat-badge">${p.category}</span>
          <h3>${p.title}</h3>
          <p>${p.excerpt}</p>
          <div class="post-meta-row">
            <span><i class="bi bi-calendar3"></i> ${p.date}</span>
            <span class="read-more">Read More <i class="bi bi-arrow-right"></i></span>
          </div>
        </div>
      </article>`;
  }

  /* ── Render + animate ── */
  function renderPosts(posts, grid, replace) {
    const html = posts.map(cardHTML).join('');
    if (replace) {
      grid.innerHTML = html;
    } else {
      grid.insertAdjacentHTML('beforeend', html);
    }
    animateBlogCards();
    attachVideoHovers(grid);
  }

  /* ── Video hover: autoplay on mouseenter, pause+reset on mouseleave ── */
  function attachVideoHovers(container) {
    container.querySelectorAll('.post-card-video-wrap').forEach(wrap => {
      const video = wrap.querySelector('video');
      const src   = wrap.dataset.videoSrc;
      if (!video || !src) return;

      wrap.addEventListener('mouseenter', () => {
        // Lazy-load src only on first hover
        if (!video.src || !video.src.includes(src.split('/').pop())) {
          video.src = src;
        }
        video.style.opacity = '1';
        wrap.classList.add('playing');
        video.play().catch(() => {});
      });

      wrap.addEventListener('mouseleave', () => {
        video.pause();
        video.currentTime = 0;
        video.style.opacity = '0';
        wrap.classList.remove('playing');
      });
    });
  }

  /* ── Load More ── */
  document.getElementById('load-more-btn').addEventListener('click', () => {
    currentPage++;
    const start = (currentPage - 1) * perPage;
    renderPosts(allPosts.slice(start, start + perPage), document.getElementById('posts-grid'), false);
    if (currentPage * perPage >= allPosts.length) {
      document.getElementById('load-more-wrap').style.display = 'none';
    }
  });

  /* ── Search ── */
  document.getElementById('search-form').addEventListener('submit', e => {
    e.preventDefault();
    const q = document.getElementById('search-input').value.trim();
    if (!q) return;
    document.querySelector('.search-overlay').classList.remove('open');
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.cat-btn[data-cat="all"]').classList.add('active');
    loadPosts('all', q);
  });

  /* ── Newsletter ── */
  document.getElementById('newsletter-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = e.target.querySelector('input').value.trim();
    const msg   = document.getElementById('newsletter-msg');
    try {
      const res = await API.post('/api/subscribe', { email });
      msg.textContent = res.message;
      msg.style.color = res.success ? '#90ee90' : '#ff6b6b';
      if (res.success) e.target.querySelector('input').value = '';
    } catch(err) {
      msg.textContent = 'Something went wrong.';
      msg.style.color = '#ff6b6b';
    }
  });

  /* ── Init ── */
  await Promise.all([loadSlider(), loadCategories()]);
  await loadPosts();

});
</script>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About — Hon. Leke Abejide</title>
  <meta name="description" content="Learn about Rt. Hon. Elder Leke Joseph Abejide, Member House of Representatives, Yagba Federal Constituency, Kogi State.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500&family=Inter:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="icon" href="/favicon.png">
</head>
<body>

<div class="nav-overlay" id="nav-overlay"></div>

<header id="header">
  <div class="header-inner">
    <a href="/" class="logo">
      <img src="/Logo.png" alt="Hon. Leke Abejide"
           style="height:28px;width:auto;object-fit:contain;display:block;">
      <span id="site-logo-text">Hon. Leke Abejide</span>
    </a>
    <nav class="navbar" id="navbar">
      <ul id="nav-links">
        <li><a href="/">Blog</a></li>
        <li><a href="/about" class="active">About</a></li>
        <li><a href="/contact">Contact</a></li>
      </ul>
    </nav>
    <div class="header-actions">
      <div class="header-social">
        <a href="https://www.facebook.com/profile.php?id=100051326707777" target="_blank"><i class="bi bi-facebook"></i></a>
        <a href="https://www.instagram.com/hon.lekeabejide" target="_blank"><i class="bi bi-instagram"></i></a>
        <a href="#" target="_blank"><i class="bi bi-twitter-x"></i></a>
      </div>
      <button class="mobile-nav-toggle" aria-label="Toggle menu"><i class="bi bi-list"></i></button>
    </div>
  </div>
</header>

<main id="main">

  <!-- About Hero -->
  <section class="about-hero">
    <div class="container">
      <h1 id="about-hero-title">About Hon. Leke Abejide</h1>
      <p id="about-hero-sub">Member, House of Representatives — Yagba Federal Constituency, Kogi State. Chairman, House Committee on Customs and Excise.</p>
    </div>
  </section>

  <!-- Profile — Hon. Leke -->
  <section class="profile-section">
    <div class="container">
      <div class="profile-grid page-fade">
        <div>
          <img id="leke-img"
               src="/image/leke abejide.jpg"
               alt="Rt. Hon. Leke Abejide"
               class="profile-img"
               onerror="this.style.background='var(--border)';this.style.minHeight='380px'">
        </div>
        <div class="profile-content">
          <h2 id="leke-name">Rt. Hon. Elder Leke Joseph Abejide</h2>
          <span class="title-badge" id="leke-title">Member, House of Representatives</span>
          <p id="leke-bio1">Rt. Hon. Elder Leke Joseph Abejide, ADC Governorship Candidate 2023, Member House of Representatives Yagba Federal Constituency, Chairman House Committee on Customs and Excise, was born on 8th of May, 1975 to his parents from Alu, Yagba East Local Government Area of Kogi State.</p>
          <p id="leke-bio2">He obtained his primary school leaving certificate at LSMB Primary School, Alu-Igbagun, before proceeding to Alu Community Secondary School in 1991 where he served as Assistant Senior Prefect — an early display of leadership and humility.</p>
          <p id="leke-bio3">He graduated from the prestigious Ahmadu Bello University Zaria with a BSc. in Economics, completed his NYSC, and later earned a Masters Degree in Economics from Bayero University (BUK) Kano.</p>
          <p id="leke-bio4">Hon. Leke Abejide is the Chairman of ABYEM INT'L LTD, a leading private clearing company and the preferred choice for importers and exporters across Nigeria. He is also the founder of Leke Abejide Foundation, a non-partisan NGO serving widows, the aged, and indigent students.</p>
          <p id="leke-bio5">He won his first election under the ADC in February 2019 and was re-elected in February 2023, serving as Chairman of the House Committee on Customs and Excise in both tenures. He is a businessman, philanthropist, community builder, and a God-fearing Elder in the Church.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Achievements -->
  <section class="achievements-section">
    <div class="container">
      <div class="section-header">
        <div class="section-tag">Track Record</div>
        <h2>Key Achievements</h2>
        <p>A legacy of service, community development, and legislative excellence across Yagba Federal Constituency.</p>
      </div>
      <div class="achievements-grid page-fade" id="achievements-grid">
        <div class="achievement-card">
          <div class="achievement-icon">🎓</div>
          <h4>WAEC Fees for All Students</h4>
          <p>Paid WAEC exam fees for all students in public schools across Yagba Federal Constituency, amounting to over ₦43 Million Naira.</p>
        </div>
        <div class="achievement-card">
          <div class="achievement-icon">👩‍👧</div>
          <h4>Widow Empowerment</h4>
          <p>Six consecutive years of dedicated empowerment programs for widows across Yagbaland — financial support and life skills training.</p>
        </div>
        <div class="achievement-card">
          <div class="achievement-icon">🏥</div>
          <h4>Healthcare Infrastructure</h4>
          <p>Renovation of health centres and provision of motorised boreholes for clean water access across communities.</p>
        </div>
        <div class="achievement-card">
          <div class="achievement-icon">🚔</div>
          <h4>Police Station Construction</h4>
          <p>Constructed a "C" Division police station in Alu community, fully equipped with a borehole, generator, and perimeter fencing.</p>
        </div>
        <div class="achievement-card">
          <div class="achievement-icon">💡</div>
          <h4>Rural Electrification</h4>
          <p>Donated poles and supported the Igbo-Ero rural electrification project, bringing power to previously underserved communities.</p>
        </div>
        <div class="achievement-card">
          <div class="achievement-icon">💼</div>
          <h4>Employment Creation</h4>
          <p>Employed over 200 Yagba indigenes directly in ABYEM INT'L LTD, supporting local livelihoods and economic growth.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Profile — Chief Mrs. Abejide -->
  <section style="background:var(--light-bg);padding:72px 0">
    <div class="container">
      <div class="profile-grid page-fade" style="grid-template-columns:1fr 340px">
        <div class="profile-content">
          <h2 id="spouse-name">Chief Mrs. Esther Modupe Abejide</h2>
          <span class="title-badge" id="spouse-title" style="background:var(--green)">Beloved Wife &amp; Philanthropist</span>
          <p id="spouse-bio1">Chief Mrs. Abejide is a loving wife and mother, a pillar of strength and unwavering support for her husband and family, and a source of inspiration to women and girls across Nigeria.</p>
          <p id="spouse-bio2">Her six years of dedication to the empowerment of widows in Yagba Federal Constituency have undoubtedly transformed the lives of countless women. She has championed access to quality education, provided health facilities, and built boreholes across Yagbaland.</p>
          <p id="spouse-bio3">Chief Mrs. Abejide continues to provide financial support to the less privileged and to students who need assistance with their education, embodying the spirit of selfless service.</p>
        </div>
        <div>
          <img id="spouse-img"
               src="/image/her ex.jpg"
               alt="Chief Mrs. Esther Modupe Abejide"
               class="profile-img"
               onerror="this.style.background='var(--border)';this.style.minHeight='350px'">
        </div>
      </div>
    </div>
  </section>

  <!-- Team Section -->
  <section class="team-section">
    <div class="container">
      <div class="section-header">
        <div class="section-tag">Our People</div>
        <h2>Our Team</h2>
        <p>Beyond the confines of legislative offices, this team serves as a vital bridge between constituents and their representative.</p>
      </div>
      <div class="team-grid page-fade" id="team-grid">
        <div class="team-card">
          <div class="team-img-wrap">
            <img src="/image/image3.jpg" alt="Team Member" class="team-img">
          </div>
          <h5>Team Member</h5>
          <span>Media Aids</span>
        </div>
        <div class="team-card">
          <div class="team-img-wrap">
            <img src="/image/image1.jpg" alt="Team Member" class="team-img">
          </div>
          <h5>Team Member</h5>
          <span>Media Aids</span>
        </div>
        <div class="team-card">
          <div class="team-img-wrap">
            <img src="/image/image5.jpg" alt="Team Member" class="team-img">
          </div>
          <h5>Team Member</h5>
          <span>Media Aids</span>
        </div>
        <div class="team-card">
          <div class="team-img-wrap">
            <img src="/image/image6.jpg" alt="Team Member" class="team-img">
          </div>
          <h5>Team Member</h5>
          <span>Media Aids</span>
        </div>
      </div>
    </div>
  </section>

</main>

<!-- Footer -->
<footer id="site-footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-brand">
        <h3>Hon. Leke Abejide</h3>
        <p>Rt. Hon. Elder Leke Joseph Abejide — Member, House of Representatives, Yagba Federal Constituency, Kogi State.</p>
      </div>
      <div class="footer-col">
        <h4>Quick Links</h4>
        <ul>
          <li><a href="/">Blog</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Connect</h4>
        <ul>
          <li><a href="https://www.facebook.com/profile.php?id=100051326707777" target="_blank"><i class="bi bi-facebook"></i> Facebook</a></li>
          <li><a href="https://www.instagram.com/hon.lekeabejide" target="_blank"><i class="bi bi-instagram"></i> Instagram</a></li>
          <li><a href="#" target="_blank"><i class="bi bi-twitter-x"></i> Twitter / X</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Newsletter</h4>
        <p style="font-size:0.85rem;opacity:.8;margin-bottom:12px">Stay updated with the latest news.</p>
        <form class="newsletter-footer-form" id="newsletter-form">
          <input type="email" placeholder="Your email address" required>
          <button type="submit">Subscribe</button>
        </form>
        <div id="newsletter-msg" style="font-size:0.82rem;margin-top:8px"></div>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2024 Hon. Leke Abejide. All Rights Reserved.</span>
      <div class="footer-social">
        <a href="https://www.facebook.com/profile.php?id=100051326707777" target="_blank"><i class="bi bi-facebook"></i></a>
        <a href="https://www.instagram.com/hon.lekeabejide" target="_blank"><i class="bi bi-instagram"></i></a>
        <a href="#" target="_blank"><i class="bi bi-twitter-x"></i></a>
      </div>
    </div>
  </div>
</footer>

<a href="#" class="scroll-top"><i class="bi bi-arrow-up"></i></a>

<script src="/js/app.js"></script>
<script>
(async function () {

  function mediaUrl(src) {
    if (!src) return '';
    return src.startsWith('http') ? src : '/' + src;
  }

  // ── Newsletter ───────────────────────────────────────────────
  const newsletterForm = document.getElementById('newsletter-form');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      const email = e.target.querySelector('input').value.trim();
      const msg   = document.getElementById('newsletter-msg');
      try {
        const res = await API.post('/api/subscribe', { email });
        msg.textContent  = res.message;
        msg.style.color  = res.success ? '#90ee90' : '#ff6b6b';
        if (res.success) e.target.querySelector('input').value = '';
      } catch(e) {
        msg.textContent = 'Something went wrong.';
        msg.style.color = '#ff6b6b';
      }
    });
  }

  // ── Load dynamic about content ───────────────────────────────
  try {
    const data = await API.get('/api/posts/site-settings');
    if (!data || !data.success) return;
    const s = data.settings;
    const a = s.about || {};

    // Hero
    if (a.heroTitle)    document.getElementById('about-hero-title').textContent = a.heroTitle;
    if (a.heroSubtitle) document.getElementById('about-hero-sub').textContent   = a.heroSubtitle;

    // Leke profile
    if (a.lekeImage) document.getElementById('leke-img').src               = mediaUrl(a.lekeImage);
    if (a.lekeName)  document.getElementById('leke-name').textContent      = a.lekeName;
    if (a.lekeTitle) document.getElementById('leke-title').textContent     = a.lekeTitle;
    [1,2,3,4,5].forEach(n => {
      const el = document.getElementById('leke-bio' + n);
      if (el && a['lekeBio' + n]) el.textContent = a['lekeBio' + n];
    });

    // Achievements
    if (a.achievements && a.achievements.length) {
      document.getElementById('achievements-grid').innerHTML =
        a.achievements.map(ac => `
          <div class="achievement-card">
            <div class="achievement-icon">${ac.icon}</div>
            <h4>${ac.title}</h4>
            <p>${ac.desc}</p>
          </div>`).join('');
    }

    // Spouse profile
    if (a.spouseImage) document.getElementById('spouse-img').src           = mediaUrl(a.spouseImage);
    if (a.spouseName)  document.getElementById('spouse-name').textContent  = a.spouseName;
    if (a.spouseTitle) document.getElementById('spouse-title').textContent = a.spouseTitle;
    [1,2,3].forEach(n => {
      const el = document.getElementById('spouse-bio' + n);
      if (el && a['spouseBio' + n]) el.textContent = a['spouseBio' + n];
    });

    // Team
    if (a.team && a.team.length) {
      document.getElementById('team-grid').innerHTML =
        a.team.map(m => `
          <div class="team-card">
            <div class="team-img-wrap">
              <img src="${mediaUrl(m.image)}" alt="${m.name}" class="team-img"
                onerror="this.parentElement.innerHTML='<div style=width:110px;height:110px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;margin:0 auto 18px><i class=bi\\ bi-person style=font-size:2rem;color:var(--muted)></i></div>'">
            </div>
            <h5>${m.name}</h5>
            <span>${m.role}</span>
          </div>`).join('');
    }

  } catch(e) {
    console.error('About page load error:', e);
  }

})();
</script>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact — Hon. Leke Abejide</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500&family=Inter:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="icon" href="/favicon.png">
</head>
<body>

<!-- Mobile Nav Overlay -->
<div class="nav-overlay" id="nav-overlay"></div>

<!-- Header -->
<header id="header">
  <div class="header-inner">
    <a href="/" class="logo">
      <img src="/Logo.png" alt="Hon. Leke Abejide" 
           style="height:28px;width:auto;object-fit:contain;display:block;">
      <span id="site-logo-text">Hon. Leke Abejide</span>
    </a>
    <nav class="navbar" id="navbar">
      <ul id="nav-links">
        <li><a href="/">Blog</a></li>
        <li><a href="/about">About</a></li>
        <li><a href="/contact" class="active">Contact</a></li>
      </ul>
    </nav>
    <div class="header-actions">
      <div class="header-social">
        <a href="#" target="_blank" id="hdr-fb"><i class="bi bi-facebook"></i></a>
        <a href="#" target="_blank" id="hdr-ig"><i class="bi bi-instagram"></i></a>
        <a href="#" target="_blank" id="hdr-tw"><i class="bi bi-twitter-x"></i></a>
      </div>
      <button class="search-toggle" aria-label="Search"><i class="bi bi-search"></i></button>
      <button class="mobile-nav-toggle" aria-label="Toggle menu"><i class="bi bi-list"></i></button>
    </div>
  </div>
</header>
<!-- Search Overlay -->
<div class="search-overlay">
  <form id="search-form">
    <input type="text" id="search-input" placeholder="Search posts…" autocomplete="off">
    <button type="submit">Search</button>
    <button type="button" class="search-close"><i class="bi bi-x"></i></button>
  </form>
</div>

<main id="main">

  <section class="about-hero">
    <div class="container">
      <h1>Get In Touch</h1>
      <p>Reach out to the office of Hon. Leke Abejide for enquiries, constituent support, or media requests.</p>
    </div>
  </section>

  <section class="contact-section">
    <div class="container">
      <div class="contact-grid page-fade">
        <div class="contact-info">
          <h2>Contact Information</h2>
          <p>Our team is available to assist you. Feel free to reach out through any of the channels below.</p>

          <div class="contact-item">
            <div class="contact-icon"><i class="bi bi-geo-alt-fill"></i></div>
            <div><h5>Office Address</h5><p>Yagba Federal Constituency<br>Kogi State, Nigeria</p></div>
          </div>
          <div class="contact-item">
            <div class="contact-icon"><i class="bi bi-envelope-fill"></i></div>
            <div><h5>Email</h5><p><a href="mailto:ayanisolomon1@gmail.com" style="color:var(--primary)" id="contact-email-link">ayanisolomon1@gmail.com</a></p></div>
          </div>
          <div class="contact-item">
            <div class="contact-icon" style="background:#1877f2"><i class="bi bi-facebook"></i></div>
            <div><h5>Facebook</h5><p><a href="#" target="_blank" id="contact-fb" style="color:var(--primary)">Hon. Leke Abejide</a></p></div>
          </div>
          <div class="contact-item">
            <div class="contact-icon" style="background:#c13584"><i class="bi bi-instagram"></i></div>
            <div><h5>Instagram</h5><p><a href="#" target="_blank" id="contact-ig" style="color:var(--primary)">@hon.lekeabejide</a></p></div>
          </div>

          <div style="margin-top:32px">
            <strong style="font-size:0.88rem;color:var(--muted);display:block;margin-bottom:12px">Follow on Social Media</strong>
            <div class="social-links">
              <a href="#" target="_blank" id="soc-fb" class="social-link"><i class="bi bi-facebook"></i></a>
              <a href="#" target="_blank" id="soc-ig" class="social-link"><i class="bi bi-instagram"></i></a>
              <a href="#" class="social-link"><i class="bi bi-twitter-x"></i></a>
              <a href="#" class="social-link"><i class="bi bi-linkedin"></i></a>
              <a href="#" class="social-link"><i class="bi bi-youtube"></i></a>
            </div>
          </div>
        </div>

        <div class="contact-form-card">
          <h3>Send a Message</h3>
          <div class="form-row">
            <div class="form-group">
              <label for="contact-name">Full Name *</label>
              <input type="text" id="contact-name" placeholder="Your full name" required>
            </div>
            <div class="form-group">
              <label for="contact-email-input">Email Address *</label>
              <input type="email" id="contact-email-input" placeholder="your@email.com" required>
            </div>
          </div>
          <div class="form-group">
            <label for="contact-subject">Subject *</label>
            <input type="text" id="contact-subject" placeholder="What is this message about?" required>
          </div>
          <div class="form-group">
            <label for="contact-message">Message *</label>
            <textarea id="contact-message" placeholder="Type your message here…" rows="6" required></textarea>
          </div>
          <button class="btn btn-primary" id="send-btn" style="width:100%;justify-content:center">
            <i class="bi bi-send"></i> Send Message
          </button>
          <div class="alert" id="contact-alert"></div>
        </div>
      </div>
    </div>
  </section>

  <section style="background:var(--light-bg);padding:64px 0">
    <div class="container">
      <div class="section-header">
        <h2>What People Say</h2>
        <p>Voices from the constituents of Yagba Federal Constituency.</p>
      </div>
      <div class="testimonials-grid">
        <div class="achievement-card" style="position:relative">
          <div style="font-size:3rem;color:var(--accent);line-height:1;margin-bottom:12px">"</div>
          <p style="font-size:0.95rem;line-height:1.8;color:#444;font-style:italic">Hon. Leke Abejide's contribution to education in our constituency is unmatched. Thousands of children can now access quality education because of his support.</p>
          <div style="margin-top:16px;font-weight:600;font-size:0.88rem;color:var(--primary)">— Community Leader, Alu</div>
        </div>
        <div class="achievement-card" style="position:relative">
          <div style="font-size:3rem;color:var(--accent);line-height:1;margin-bottom:12px">"</div>
          <p style="font-size:0.95rem;line-height:1.8;color:#444;font-style:italic">The police station he built has made our community safer. We no longer fear criminals like before. He truly cares about our welfare.</p>
          <div style="margin-top:16px;font-weight:600;font-size:0.88rem;color:var(--primary)">— Resident, Alu Community</div>
        </div>
        <div class="achievement-card" style="position:relative">
          <div style="font-size:3rem;color:var(--accent);line-height:1;margin-bottom:12px">"</div>
          <p style="font-size:0.95rem;line-height:1.8;color:#444;font-style:italic">As a widow, the support from Hon. Leke Abejide Foundation has been life-changing. He remembers us when others forget.</p>
          <div style="margin-top:16px;font-weight:600;font-size:0.88rem;color:var(--primary)">— Beneficiary, Yagba East</div>
        </div>
      </div>
    </div>
  </section>

</main>

<!-- Footer -->
<footer id="site-footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-brand">
        <h3>Hon. Leke Abejide</h3>
        <p>Rt. Hon. Elder Leke Joseph Abejide — Member, House of Representatives, Yagba Federal Constituency, Kogi State.</p>
      </div>
      <div class="footer-col">
        <h4>Quick Links</h4>
        <ul>
          <li><a href="/">Blog</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Connect</h4>
        <ul>
          <li><a href="#" target="_blank" id="ft-fb"><i class="bi bi-facebook"></i> Facebook</a></li>
          <li><a href="#" target="_blank" id="ft-ig"><i class="bi bi-instagram"></i> Instagram</a></li>
          <li><a href="#" target="_blank" id="ft-tw"><i class="bi bi-twitter-x"></i> Twitter / X</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2024 Hon. Leke Abejide. All Rights Reserved.</span>
      <div class="footer-social">
        <a href="#" target="_blank" id="ft-soc-fb"><i class="bi bi-facebook"></i></a>
        <a href="#" target="_blank" id="ft-soc-ig"><i class="bi bi-instagram"></i></a>
        <a href="#" target="_blank" id="ft-soc-tw"><i class="bi bi-twitter-x"></i></a>
      </div>
    </div>
  </div>
</footer>

<a href="#" class="scroll-top"><i class="bi bi-arrow-up"></i></a>

<!-- app.js handles hamburger nav via DOMContentLoaded -->
<script src="/js/app.js"></script>
<script>
(async function () {
  /* ── Settings: social links & contact email ── */
  try {
    const s = await API.get('/api/admin/settings');
    if (s.success && s.settings) {
      const settings = s.settings;
      if (settings.facebookUrl) {
        ['hdr-fb','drawer-fb','contact-fb','soc-fb','ft-fb','ft-soc-fb'].forEach(function(id) {
          var el = document.getElementById(id); if (el) el.href = settings.facebookUrl;
        });
      }
      if (settings.instagramUrl) {
        ['hdr-ig','drawer-ig','contact-ig','soc-ig','ft-ig','ft-soc-ig'].forEach(function(id) {
          var el = document.getElementById(id); if (el) el.href = settings.instagramUrl;
        });
      }
      if (settings.twitterUrl) {
        ['hdr-tw','drawer-tw','ft-tw','ft-soc-tw'].forEach(function(id) {
          var el = document.getElementById(id); if (el) el.href = settings.twitterUrl;
        });
      }
      if (settings.contactEmail) {
        var emailLink = document.getElementById('contact-email-link');
        if (emailLink) {
          emailLink.href = 'mailto:' + settings.contactEmail;
          emailLink.textContent = settings.contactEmail;
        }
      }
    }
  } catch(e) {}

  /* ── Contact form ── */
  document.getElementById('send-btn').addEventListener('click', async function () {
    var name    = document.getElementById('contact-name').value.trim();
    var email   = document.getElementById('contact-email-input').value.trim();
    var subject = document.getElementById('contact-subject').value.trim();
    var message = document.getElementById('contact-message').value.trim();
    var alertEl = document.getElementById('contact-alert');
    var btn     = document.getElementById('send-btn');

    if (!name || !email || !subject || !message) {
      showAlert(alertEl, 'error', 'Please fill in all fields.'); return;
    }
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showAlert(alertEl, 'error', 'Please enter a valid email address.'); return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending…';

    try {
      var res = await API.post('/api/contact', { name, email, subject, message });
      if (res.success) {
        showAlert(alertEl, 'success', res.message);
        document.getElementById('contact-name').value    = '';
        document.getElementById('contact-email-input').value = '';
        document.getElementById('contact-subject').value = '';
        document.getElementById('contact-message').value = '';
      } else {
        showAlert(alertEl, 'error', res.message || 'Something went wrong.');
      }
    } catch(e) {
      showAlert(alertEl, 'error', 'Network error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-send"></i> Send Message';
    }
  });

  /* ── Search redirect ── */
  document.getElementById('search-form').addEventListener('submit', function(e) {
    e.preventDefault();
    var q = document.getElementById('search-input').value.trim();
    if (q) window.location.href = '/?search=' + encodeURIComponent(q);
  });

  /* ── Helper: show inline alert ── */
  function showAlert(el, type, msg) {
    el.className = 'alert alert-' + (type === 'success' ? 'success' : 'error') + ' show';
    el.textContent = msg;
    el.style.display = 'block';
    el.style.marginTop = '14px';
  }
})();
</script>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title id="page-title">Post — Hon. Leke Abejide</title>
  <meta id="og-title"       property="og:title"        content="Hon. Leke Abejide">
  <meta id="og-description" property="og:description"  content="Official blog of Rt. Hon. Leke Abejide, Member House of Representatives.">
  <meta id="og-image"       property="og:image"        content="/favicon.png">
  <meta id="og-url"         property="og:url"          content="">
  <meta id="og-type"        property="og:type"         content="article">
  <meta id="og-site"        property="og:site_name"    content="Hon. Leke Abejide">
  <meta id="tw-card"        name="twitter:card"        content="summary_large_image">
  <meta id="tw-title"       name="twitter:title"       content="Hon. Leke Abejide">
  <meta id="tw-description" name="twitter:description" content="Official blog of Rt. Hon. Leke Abejide, Member House of Representatives.">
  <meta id="tw-image"       name="twitter:image"       content="/favicon.png">
  <meta name="description"  content="Official blog of Rt. Hon. Leke Abejide, Member House of Representatives.">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500&family=Inter:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="icon" href="/favicon.png">
  <style>
    /* ── Skeleton loader ── */
    .skeleton {
      background: linear-gradient(90deg,
        var(--border) 25%,
        color-mix(in srgb, var(--border) 60%, transparent) 50%,
        var(--border) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
      border-radius: 6px;
    }
    @keyframes shimmer {
      0%   { background-position:  200% 0; }
      100% { background-position: -200% 0; }
    }
    .skeleton-hero   { height: 400px; border-radius: 12px; margin-bottom: 28px; }
    .skeleton-badge  { height: 22px; width: 100px; margin-bottom: 14px; }
    .skeleton-title  { height: 40px; width: 85%; margin-bottom: 10px; }
    .skeleton-title2 { height: 40px; width: 60%; margin-bottom: 20px; }
    .skeleton-meta   { height: 18px; width: 220px; margin-bottom: 28px; }
    .skeleton-line   { height: 16px; margin-bottom: 10px; }
    .skeleton-line.short  { width: 70%; }
    .skeleton-line.xshort { width: 45%; }

    /* ── Cookie Banner ── */
    #cookie-banner {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
      background: var(--dark, #111); color: #eee;
      padding: 16px 24px;
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; flex-wrap: wrap;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.3);
      transform: translateY(100%);
      transition: transform 0.4s ease;
    }
    #cookie-banner.show { transform: translateY(0); }
    #cookie-banner p { margin: 0; font-size: 0.88rem; flex: 1; min-width: 200px; }
    #cookie-banner a { color: #90cdf4; }
    .cookie-btns { display: flex; gap: 10px; flex-shrink: 0; }
    .cookie-btn-accept {
      background: var(--primary, #1a56db); color: #fff;
      border: none; padding: 8px 20px; border-radius: 6px;
      cursor: pointer; font-size: 0.85rem; font-weight: 600;
    }
    .cookie-btn-decline {
      background: transparent; color: #aaa;
      border: 1px solid #555; padding: 8px 16px;
      border-radius: 6px; cursor: pointer; font-size: 0.85rem;
    }

    img.lazy-img { transition: opacity 0.3s ease; }
    img.lazy-img.skeleton { opacity: 0.5; }

    /* ── Image right-click protection ── */
    .post-single-img, .post-card-img {
      -webkit-user-select: none;
      user-select: none;
      pointer-events: none;
    }
    .img-protect-overlay {
      position: absolute; inset: 0; z-index: 10; cursor: default;
    }

    /* ── Video ── */
    .post-video-wrap {
      position: relative; width: 100%;
      border-radius: var(--radius-md, 12px);
      overflow: hidden; margin: 28px 0; background: #000;
    }
    .post-video-wrap video { width: 100%; display: block; }

    /* ── Markdown rendered content ── */
    .post-single-content { line-height: 1.85; }

    .post-single-content h1,
    .post-single-content h2,
    .post-single-content h3,
    .post-single-content h4 {
      font-family: 'Playfair Display', Georgia, serif;
      color: var(--heading, #1a1a1a);
      margin: 1.6em 0 0.6em;
      line-height: 1.3;
    }
    .post-single-content h1 { font-size: 2rem; }
    .post-single-content h2 { font-size: 1.55rem; }
    .post-single-content h3 { font-size: 1.25rem; }
    .post-single-content h4 { font-size: 1.05rem; }

    .post-single-content p { margin-bottom: 1.3em; }

    .post-single-content strong { font-weight: 700; }
    .post-single-content em    { font-style: italic; }

    .post-single-content ul,
    .post-single-content ol {
      margin: 0 0 1.2em 1.6em;
      padding: 0;
    }
    .post-single-content li { margin-bottom: 0.4em; line-height: 1.7; }

    .post-single-content blockquote {
      border-left: 4px solid var(--accent, #c8971f);
      margin: 1.4em 0;
      padding: 12px 20px;
      background: color-mix(in srgb, var(--accent, #c8971f) 8%, transparent);
      border-radius: 0 8px 8px 0;
      font-style: italic;
      color: var(--muted, #555);
    }
    .post-single-content blockquote p { margin-bottom: 0; }

    .post-single-content code {
      background: color-mix(in srgb, var(--primary, #1a3c5e) 10%, transparent);
      padding: 2px 7px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.88em;
      color: var(--primary, #1a3c5e);
    }
    .post-single-content pre {
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 18px 20px;
      border-radius: 10px;
      margin: 1.4em 0;
      overflow-x: auto;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .post-single-content pre code {
      background: none;
      padding: 0;
      color: inherit;
      font-size: inherit;
    }

    .post-single-content hr {
      border: none;
      border-top: 2px solid var(--border, #e5ddd0);
      margin: 2em 0;
    }

    .post-single-content a {
      color: var(--primary, #1a3c5e);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .post-single-content a:hover { opacity: 0.75; }

    .post-single-content table {
      width: 100%; border-collapse: collapse; margin: 1.4em 0;
      font-size: 0.92rem;
    }
    .post-single-content th,
    .post-single-content td {
      border: 1px solid var(--border, #e5ddd0);
      padding: 10px 14px; text-align: left;
    }
    .post-single-content th {
      background: color-mix(in srgb, var(--primary, #1a3c5e) 8%, transparent);
      font-weight: 700;
    }
    .post-single-content tr:nth-child(even) td {
      background: color-mix(in srgb, var(--border, #e5ddd0) 30%, transparent);
    }
  </style>
</head>
<body>

<div class="nav-overlay" id="nav-overlay"></div>

<script>
  document.addEventListener("contextmenu", function(e) {
    if (e.target.tagName === "IMG") e.preventDefault();
  });
</script>

<header id="header">
  <div class="header-inner">
    <a href="/" class="logo">
      <img src="/Logo.png" alt="Hon. Leke Abejide"
           style="height:28px;width:auto;object-fit:contain;display:block;">
      <span id="site-logo-text">Hon. Leke Abejide</span>
    </a>
    <nav class="navbar" id="navbar">
      <ul id="nav-links">
        <li><a href="/">Blog</a></li>
        <li><a href="/about">About</a></li>
        <li><a href="/contact">Contact</a></li>
      </ul>
    </nav>
    <div class="header-actions">
      <div class="header-social">
        <a href="#" target="_blank" id="hdr-fb"><i class="bi bi-facebook"></i></a>
        <a href="#" target="_blank" id="hdr-ig"><i class="bi bi-instagram"></i></a>
      </div>
      <button class="search-toggle" aria-label="Search"><i class="bi bi-search"></i></button>
      <button class="mobile-nav-toggle" aria-label="Toggle menu" aria-expanded="false">
        <i class="bi bi-list"></i>
      </button>
    </div>
  </div>
</header>

<div class="search-overlay">
  <form id="search-form">
    <input type="text" id="search-input" placeholder="Search posts…" autocomplete="off">
    <button type="submit">Search</button>
    <button type="button" class="search-close"><i class="bi bi-x"></i></button>
  </form>
</div>

<main id="main">
  <section class="post-single">
    <div class="container">
      <div class="layout-with-sidebar">

        <div class="post-main">
          <a href="/" class="back-link"><i class="bi bi-arrow-left"></i> Back to Blog</a>

          <div id="post-skeleton">
            <div class="skeleton skeleton-hero"></div>
            <div class="skeleton skeleton-badge"></div>
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-title2"></div>
            <div class="skeleton skeleton-meta"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line short"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line xshort"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line short"></div>
          </div>

          <div id="post-content" style="display:none"></div>

          <div class="comments-section" id="comments-section" style="display:none">
            <h3 id="comments-title">Comments</h3>
            <div id="comments-list"></div>
            <div class="comment-form">
              <h4>Leave a Comment</h4>
              <div class="form-row">
                <div class="form-group">
                  <label for="comment-name">Name *</label>
                  <input type="text" id="comment-name" placeholder="Your name" required>
                </div>
                <div class="form-group">
                  <label for="comment-email">Email *</label>
                  <input type="email" id="comment-email" placeholder="Your email" required>
                </div>
              </div>
              <div class="form-group">
                <label for="comment-message">Comment *</label>
                <textarea id="comment-message" placeholder="Share your thoughts…" rows="5" required></textarea>
              </div>
              <button class="btn btn-primary" id="post-comment-btn">
                <i class="bi bi-chat-left-text"></i> Post Comment
              </button>
              <div class="alert" id="comment-alert"></div>
            </div>
          </div>
        </div>

        <aside class="sidebar">
          <div class="sidebar-widget">
            <h4><i class="bi bi-clock-history"></i> Recent Posts</h4>
            <div id="recent-posts">
              <div style="display:flex;flex-direction:column;gap:12px">
                <div style="display:flex;gap:10px;align-items:center">
                  <div class="skeleton" style="width:60px;height:60px;border-radius:8px;flex-shrink:0"></div>
                  <div style="flex:1">
                    <div class="skeleton" style="height:14px;margin-bottom:6px"></div>
                    <div class="skeleton" style="height:12px;width:60%"></div>
                  </div>
                </div>
                <div style="display:flex;gap:10px;align-items:center">
                  <div class="skeleton" style="width:60px;height:60px;border-radius:8px;flex-shrink:0"></div>
                  <div style="flex:1">
                    <div class="skeleton" style="height:14px;margin-bottom:6px"></div>
                    <div class="skeleton" style="height:12px;width:60%"></div>
                  </div>
                </div>
                <div style="display:flex;gap:10px;align-items:center">
                  <div class="skeleton" style="width:60px;height:60px;border-radius:8px;flex-shrink:0"></div>
                  <div style="flex:1">
                    <div class="skeleton" style="height:14px;margin-bottom:6px"></div>
                    <div class="skeleton" style="height:12px;width:60%"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="sidebar-widget">
            <h4><i class="bi bi-tags"></i> Categories</h4>
            <div id="sidebar-categories" class="sidebar-cats">
              <div class="skeleton" style="height:14px;margin-bottom:8px;width:80%"></div>
              <div class="skeleton" style="height:14px;margin-bottom:8px;width:60%"></div>
              <div class="skeleton" style="height:14px;width:70%"></div>
            </div>
          </div>

          <div class="sidebar-widget">
            <h4><i class="bi bi-envelope"></i> Newsletter</h4>
            <p style="font-size:0.85rem;color:var(--muted);margin-bottom:14px">Stay updated with the latest news.</p>
            <form class="newsletter-form" id="newsletter-form">
              <input type="email" placeholder="Your email address" required>
              <button type="submit">Subscribe</button>
            </form>
            <div id="newsletter-msg" style="font-size:0.82rem;margin-top:8px;color:var(--green)"></div>
          </div>

          <div class="sidebar-widget">
            <h4><i class="bi bi-share"></i> Follow Us</h4>
            <div class="social-links">
              <a href="#" target="_blank" id="sb-fb" class="social-link"><i class="bi bi-facebook"></i></a>
              <a href="#" target="_blank" id="sb-ig" class="social-link"><i class="bi bi-instagram"></i></a>
              <a href="#" target="_blank" class="social-link"><i class="bi bi-twitter-x"></i></a>
              <a href="#" target="_blank" class="social-link"><i class="bi bi-youtube"></i></a>
            </div>
          </div>
        </aside>

      </div>
    </div>
  </section>
</main>

<footer id="site-footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-brand">
        <h3>Hon. Leke Abejide</h3>
        <p>Rt. Hon. Elder Leke Joseph Abejide — Member, House of Representatives, Yagba Federal Constituency, Kogi State.</p>
      </div>
      <div class="footer-col">
        <h4>Quick Links</h4>
        <ul>
          <li><a href="/">Blog</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Connect</h4>
        <ul>
          <li><a href="#" target="_blank" id="ft-fb"><i class="bi bi-facebook"></i> Facebook</a></li>
          <li><a href="#" target="_blank" id="ft-ig"><i class="bi bi-instagram"></i> Instagram</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2024 Hon. Leke Abejide. All Rights Reserved.</span>
    </div>
  </div>
</footer>

<a href="#" class="scroll-top"><i class="bi bi-arrow-up"></i></a>

<div id="cookie-banner" role="dialog" aria-label="Cookie consent">
  <p>
    We use cookies to improve your experience.
    By continuing, you agree to our use of cookies.
    <a href="/about">Learn more</a>
  </p>
  <div class="cookie-btns">
    <button class="cookie-btn-decline" id="cookie-decline">Decline</button>
    <button class="cookie-btn-accept" id="cookie-accept">Accept All</button>
  </div>
</div>

<!-- marked.js for markdown rendering -->
<script src="https://cdn.jsdelivr.net/npm/marked@9/marked.min.js"></script>
<script src="/js/app.js"></script>
<script>
(async function () {

  /* ── Configure marked ── */
  marked.setOptions({
    breaks: true,   // single newline = <br>
    gfm:    true,   // GitHub Flavored Markdown (tables, strikethrough etc.)
  });

  /* ── Helpers ── */
  function mediaUrl(src) {
    if (!src) return '';
    return src.startsWith('http') ? src : '/' + src;
  }

  function toYouTubeEmbed(url) {
    if (!url) return '';
    if (url.includes('/embed/')) return url;
    const short = url.match(/youtu\.be\/([^?&]+)/);
    if (short) return 'https://www.youtube.com/embed/' + short[1];
    const watch = url.match(/[?&]v=([^&]+)/);
    if (watch) return 'https://www.youtube.com/embed/' + watch[1];
    return url;
  }

  function showAlert(el, type, msg) {
    el.className = 'alert alert-' + (type === 'success' ? 'success' : 'error') + ' show';
    el.textContent = msg;
    el.style.display = 'block';
    el.style.marginTop = '14px';
  }

  function lazyImg(src, cls, alt, onerrorCode) {
    return `<img
      data-src="${src}"
      src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
      class="${cls} lazy-img skeleton"
      alt="${alt || ''}"
      loading="lazy"
      onerror="${onerrorCode || "this.style.display='none'"}"
    >`;
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Get post ID from URL ── */
  const postId = window.location.pathname.split('/').pop();
  if (!postId || postId.length < 10) { window.location.href = '/'; return; }

  let siteOwnerName = 'Hon. Leke Abejide';

  /* ── Settings ── */
  try {
    const s = await API.get('/api/posts/site-settings');
    if (s.success && s.settings) {
      if (s.settings.heroTitle) siteOwnerName = s.settings.heroTitle;
      if (s.settings.facebookUrl) {
        ['hdr-fb', 'sb-fb', 'ft-fb'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.href = s.settings.facebookUrl;
        });
      }
      if (s.settings.instagramUrl) {
        ['hdr-ig', 'sb-ig', 'ft-ig'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.href = s.settings.instagramUrl;
        });
      }
    }
  } catch (e) {}

  /* ── OG tag sync for browser tab (crawlers get server-injected values) ── */
  async function injectOGTags(postId) {
    try {
      const og = await API.get('/api/posts/' + postId + '/og');
      if (!og.success) return;
      document.title = og.title + ' — ' + og.siteName;
      const setMeta = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) el.setAttribute('content', val);
      };
      setMeta('og-title',       og.title);
      setMeta('og-description', og.description);
      setMeta('og-image',       og.image);
      setMeta('og-url',         og.url || window.location.href);
      setMeta('og-site',        og.siteName);
      setMeta('tw-title',       og.title);
      setMeta('tw-description', og.description);
      setMeta('tw-image',       og.image);
    } catch(e) {}
  }

  /* ── Render markdown text block ── */
  function renderTextBlock(text) {
    if (!text) return '';
    // marked.parse returns safe HTML from markdown
    return marked.parse(text);
  }

  /* ── Image block with protection overlay ── */
  function renderImageBlock(b) {
    if (!b.image) return '';
    return (
      '<figure style="margin:28px 0">' +
        '<div class="post-single-img-wrap" style="position:relative">' +
          '<div class="post-single-img-blur" data-bg-src="' + mediaUrl(b.image) + '"></div>' +
          lazyImg(mediaUrl(b.image), 'post-single-img', b.caption || '', "this.parentElement.style.display='none'") +
          '<div class="img-protect-overlay" oncontextmenu="return false"></div>' +
        '</div>' +
        (b.caption
          ? '<figcaption style="text-align:center;font-size:0.82rem;color:var(--muted);margin-top:8px;font-style:italic">'
            + escHtml(b.caption) + '</figcaption>'
          : '') +
      '</figure>'
    );
  }

  /* ── Video block — full playback ── */
  function renderVideoBlock(b) {
    if (b.videoType === 'youtube' && b.videoUrl) {
      const embedUrl = toYouTubeEmbed(b.videoUrl) + '?rel=0&modestbranding=1';
      return (
        '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;margin:28px 0">' +
        '<iframe src="' + embedUrl + '" ' +
        'style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen loading="lazy"></iframe>' +
        '</div>'
      );
    }
    if (b.videoSrc) {
      return (
        '<div class="post-video-wrap">' +
        '<video controls style="width:100%;display:block">' +
        '<source src="' + mediaUrl(b.videoSrc) + '" type="video/mp4">' +
        'Your browser does not support video.' +
        '</video>' +
        '</div>'
      );
    }
    return '';
  }

  /* ── Load post ── */
  async function loadPost() {
    const skeleton = document.getElementById('post-skeleton');
    const el       = document.getElementById('post-content');
    try {
      const data = await API.get('/api/posts/' + postId);
      if (!data.success || !data.post) throw new Error('Not found');
      const p = data.post;

      let bodyHtml = '';

      if (p.blocks && p.blocks.length) {
        bodyHtml = p.blocks.map(b => {
          if (b.type === 'text')  return '<div class="post-single-content">' + renderTextBlock(b.text || '') + '</div>';
          if (b.type === 'image') return renderImageBlock(b);
          if (b.type === 'video') return renderVideoBlock(b);
          return '';
        }).join('');
      } else {
        // Legacy post
        let mediaHtml = '';
        if (p.hasVideo && p.videoType === 'youtube' && p.videoUrl) {
          mediaHtml = renderVideoBlock({ videoType:'youtube', videoUrl: p.videoUrl });
        } else if (p.hasVideo && p.videoSrc) {
          mediaHtml = renderVideoBlock({ videoType:'upload', videoSrc: p.videoSrc });
        } else if (p.images && p.images.length > 1) {
          mediaHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:28px">' +
            p.images.map(img =>
              '<div class="post-single-img-wrap" style="margin-bottom:0;position:relative">' +
              '<div class="post-single-img-blur" data-bg-src="' + mediaUrl(img) + '"></div>' +
              lazyImg(mediaUrl(img), 'post-single-img', p.title, "this.parentElement.style.display='none'") +
              '<div class="img-protect-overlay" oncontextmenu="return false"></div>' +
              '</div>'
            ).join('') + '</div>';
        } else if (p.image) {
          mediaHtml = renderImageBlock({ image: p.image });
        }
        bodyHtml = mediaHtml + '<div class="post-single-content">' + renderTextBlock(p.content || '') + '</div>';
      }

      el.innerHTML =
        '<div class="post-single-header page-fade">' +
        '<span class="post-cat-badge">' + escHtml(p.category) + '</span>' +
        '<h1>' + escHtml(p.title) + '</h1>' +
        '<div class="post-meta-row" style="margin-bottom:28px">' +
        '<span><i class="bi bi-calendar3"></i> ' + escHtml(p.date) + '</span>' +
        '<span><i class="bi bi-person"></i> ' + escHtml(siteOwnerName) + '</span>' +
        '</div>' +
        bodyHtml +
        '<div class="share-row"><strong>Share:</strong><div class="social-links">' +
        '<a href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(window.location.href) + '" target="_blank" class="social-link"><i class="bi bi-facebook"></i></a>' +
        '<a href="https://twitter.com/intent/tweet?url=' + encodeURIComponent(window.location.href) + '&text=' + encodeURIComponent(p.title) + '" target="_blank" class="social-link"><i class="bi bi-twitter-x"></i></a>' +
        '<a href="https://wa.me/?text=' + encodeURIComponent(p.title + ' ' + window.location.href) + '" target="_blank" class="social-link" style="color:#25d366"><i class="bi bi-whatsapp"></i></a>' +
        '</div></div></div>';

      injectOGTags(postId);

      skeleton.style.display = 'none';
      el.style.display = 'block';
      LazyLoader.observe(el);

      document.getElementById('comments-section').style.display = 'block';
      loadComments();
    } catch (e) {
      skeleton.style.display = 'none';
      el.style.display = 'block';
      el.innerHTML =
        '<div class="no-posts"><i class="bi bi-exclamation-circle"></i>' +
        '<p>Post not found.</p>' +
        '<a href="/" class="btn btn-primary" style="margin-top:16px">← Back to Blog</a></div>';
    }
  }

  /* ── Comments ── */
  async function loadComments() {
    const list  = document.getElementById('comments-list');
    const title = document.getElementById('comments-title');
    try {
      const data     = await API.get('/api/posts/' + postId + '/comments');
      const comments = data.comments || [];
      title.textContent = comments.length + ' Comment' + (comments.length !== 1 ? 's' : '');
      if (!comments.length) {
        list.innerHTML = '<p style="color:var(--muted);font-size:0.9rem;margin-bottom:24px">No comments yet. Be the first!</p>';
        return;
      }
      list.innerHTML = comments.map(c => {
        const hasReply = c.reply && c.reply.trim();
        return (
          '<div class="comment-item">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
              '<span class="comment-author"><i class="bi bi-person-circle"></i> ' + escHtml(c.name) + '</span>' +
              '<span class="comment-date">' + escHtml(c.date) + '</span>' +
            '</div>' +
            '<p style="margin:0;font-size:0.95rem;line-height:1.7">' + escHtml(c.message) + '</p>' +
            (hasReply
              ? '<div style="margin-top:14px;padding:12px 16px;background:#f0f7ee;border-left:3px solid #2a7a4b;border-radius:6px">' +
                  '<div style="font-size:0.75rem;font-weight:700;color:#2a7a4b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">' +
                    '<i class="bi bi-reply-fill"></i> Reply from ' + escHtml(siteOwnerName) +
                  '</div>' +
                  '<p style="margin:0;font-size:0.9rem;line-height:1.65;color:#333">' + escHtml(c.reply) + '</p>' +
                  (c.repliedAt ? '<div style="font-size:0.75rem;color:#6c757d;margin-top:6px">' + escHtml(c.repliedAt) + '</div>' : '') +
                '</div>'
              : '') +
          '</div>'
        );
      }).join('');
    } catch (e) { list.innerHTML = ''; }
  }

  document.getElementById('post-comment-btn').addEventListener('click', async function () {
    const name    = document.getElementById('comment-name').value.trim();
    const email   = document.getElementById('comment-email').value.trim();
    const message = document.getElementById('comment-message').value.trim();
    const alertEl = document.getElementById('comment-alert');
    const btn     = this;
    if (!name || !email || !message) { showAlert(alertEl, 'error', 'Please fill in all fields.'); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Posting…';
    try {
      const res = await API.post('/api/posts/' + postId + '/comments', { name, email, message });
      if (res.success) {
        showAlert(alertEl, 'success', res.message);
        document.getElementById('comment-name').value    = '';
        document.getElementById('comment-email').value   = '';
        document.getElementById('comment-message').value = '';
        loadComments();
      } else {
        showAlert(alertEl, 'error', res.message);
      }
    } catch (e) {
      showAlert(alertEl, 'error', 'Something went wrong.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-chat-left-text"></i> Post Comment';
    }
  });

  /* ── Sidebar: recent posts ── */
  async function loadRecentPosts() {
    const el = document.getElementById('recent-posts');
    try {
      const data  = await API.get('/api/posts');
      const posts = (data.posts || []).filter(p => p.id !== postId).slice(0, 5);
      if (!posts.length) { el.innerHTML = '<p style="color:var(--muted);font-size:0.85rem">No other posts.</p>'; return; }
      el.innerHTML = posts.map(p =>
        '<div class="recent-post-item" onclick="window.location.href=\'/post/' + p.id + '\'" style="cursor:pointer">' +
        (p.image
          ? '<img class="recent-post-thumb lazy-img skeleton" data-src="' + mediaUrl(p.image) + '" ' +
            'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" ' +
            'alt="' + escHtml(p.title) + '" loading="lazy" onerror="this.style.display=\'none\'">'
          : '<div class="recent-post-thumb recent-post-thumb-placeholder"><i class="bi bi-newspaper"></i></div>') +
        '<div class="recent-post-info"><h6>' + escHtml(p.title.substring(0, 55)) + (p.title.length > 55 ? '…' : '') + '</h6><span>' + escHtml(p.date) + '</span></div>' +
        '</div>'
      ).join('');
      LazyLoader.observe(el);
    } catch (e) {}
  }

  /* ── Sidebar: categories ── */
  async function loadSidebarCategories() {
    const el = document.getElementById('sidebar-categories');
    try {
      const data = await API.get('/api/posts/categories');
      el.innerHTML = (data.categories || []).map(cat =>
        '<a href="/?category=' + encodeURIComponent(cat.toLowerCase()) + '" class="sidebar-cat-link">' + escHtml(cat) + '</a>'
      ).join('');
    } catch (e) { el.innerHTML = ''; }
  }

  /* ── Newsletter ── */
  document.getElementById('newsletter-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const email = e.target.querySelector('input').value.trim();
    const msg   = document.getElementById('newsletter-msg');
    try {
      const res = await API.post('/api/subscribe', { email });
      msg.textContent = res.message;
      if (res.success) e.target.querySelector('input').value = '';
    } catch (e) { msg.textContent = 'Something went wrong.'; }
  });

  /* ── Search ── */
  document.getElementById('search-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const q = document.getElementById('search-input').value.trim();
    if (q) window.location.href = '/?search=' + encodeURIComponent(q);
  });

  /* ── Init ── */
  await loadPost();
  loadRecentPosts();
  loadSidebarCategories();

})();
</script>
</body>
</html>
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
/* ============================================================
   Hon. Leke Abejide — style.css
   Complete stylesheet — all pages, dark mode, animations
   ============================================================ */

/* ===== CSS Variables ===== */
:root {
  --primary: #1a3c5e;
  --accent: #c8971f;
  --light-bg: #f9f5ef;
  --dark-text: #1a1a1a;
  --muted: #6c757d;
  --border: #e5ddd0;
  --white: #ffffff;
  --green: #2a7a4b;
  --red: #dc3545;
  --header-height: 72px;
  --font-serif: 'Playfair Display', Georgia, serif;
  --font-sans: 'Inter', 'Segoe UI', sans-serif;
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --shadow-sm: 0 2px 10px rgba(0,0,0,0.06);
  --shadow-md: 0 8px 24px rgba(0,0,0,0.10);
  --shadow-lg: 0 20px 48px rgba(0,0,0,0.14);
  --transition: 0.28s ease;
}

/* ===== Dark Mode Variables ===== */
[data-theme="dark"] {
  --primary:   #4a9eda;
  --accent:    #e0aa3e;
  --light-bg:  #1a1f2e;
  --dark-text: #e8e6e1;
  --muted:     #9aa3b0;
  --border:    #2e3447;
  --white:     #13171f;
  --green:     #3db56a;
  --red:       #f05766;
  --shadow-sm: 0 2px 10px rgba(0,0,0,0.3);
  --shadow-md: 0 8px 24px rgba(0,0,0,0.4);
  --shadow-lg: 0 20px 48px rgba(0,0,0,0.5);
}

/* Dark mode specific overrides */
[data-theme="dark"] body { background: #0f1219; }
[data-theme="dark"] #header {
  background: rgba(19,23,31,0.9);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom-color: var(--border);
}
[data-theme="dark"] .navbar {
  background: #13171f;
  box-shadow: -6px 0 28px rgba(0,0,0,0.5);
}
[data-theme="dark"] .navbar a:hover  { background: #1e2535; }
[data-theme="dark"] .navbar a.active { background: #1e3a5f; }
[data-theme="dark"] .search-overlay  { background: #13171f; }
[data-theme="dark"] .search-overlay input { background: #1a1f2e; color: var(--dark-text); }
[data-theme="dark"] .post-card       { background: #13171f; }
[data-theme="dark"] .post-card:hover { background: #181d28; }
[data-theme="dark"] .post-card-img-placeholder { background: #1e2535; }
[data-theme="dark"] .achievement-card { background: #13171f; }
[data-theme="dark"] .team-card        { background: #13171f; }
[data-theme="dark"] .contact-form-card { background: #13171f; }
[data-theme="dark"] .contact-form-card input,
[data-theme="dark"] .contact-form-card textarea { background: #1a1f2e; color: var(--dark-text); border-color: var(--border); }
[data-theme="dark"] .contact-form-card input::placeholder,
[data-theme="dark"] .contact-form-card textarea::placeholder { color: var(--muted); }
[data-theme="dark"] .about-hero       { background: #1a1f2e; }
[data-theme="dark"] .profile-section  { background: #0f1219; }
[data-theme="dark"] .achievements-section { background: #13171f; }
[data-theme="dark"] .team-section     { background: #0f1219; }
[data-theme="dark"] #site-footer      { background: #0a0d14; border-top-color: var(--border); }
[data-theme="dark"] .footer-bottom    { border-top-color: var(--border); }
[data-theme="dark"] .sidebar-post     { background: #13171f; }
[data-theme="dark"] .single-post-hero { background: #1a1f2e; }
[data-theme="dark"] .single-post-body { background: #0f1219; color: var(--dark-text); }
[data-theme="dark"] .comment-card     { background: #13171f; }
[data-theme="dark"] .comment-form input,
[data-theme="dark"] .comment-form textarea { background: #1a1f2e; color: var(--dark-text); border-color: var(--border); }
[data-theme="dark"] .nav-overlay      { background: rgba(0,0,0,0.75); }
[data-theme="dark"] .hero-slider-section { background: #0f1219; }
[data-theme="dark"] .blog-section     { background: #0f1219; }
[data-theme="dark"] .blog-section-header h2 { color: var(--dark-text); }
[data-theme="dark"] .cat-btn          { background: #1a1f2e; color: var(--muted); border-color: var(--border); }
[data-theme="dark"] .cat-btn:hover,
[data-theme="dark"] .cat-btn.active   { background: var(--primary); color: #fff; border-color: var(--primary); }
[data-theme="dark"] .post-card-body h3 { color: var(--dark-text); }
[data-theme="dark"] .post-card-body p  { color: var(--muted); }
[data-theme="dark"] .post-meta-row     { border-top-color: var(--border); color: var(--muted); }
[data-theme="dark"] .newsletter-section { background: #13171f; }
[data-theme="dark"] .newsletter-form input { background: #1a1f2e; color: var(--dark-text); border-color: var(--border); }
[data-theme="dark"] .profile-content p { color: var(--muted); }
[data-theme="dark"] .section-header p,
[data-theme="dark"] .blog-section-header p { color: var(--muted); }
[data-theme="dark"] .post-single-content { color: #e8e6e1; }
[data-theme="dark"] .comment-item { background: #1a1f2e; }
[data-theme="dark"] .sidebar-widget { background: #13171f; border-color: var(--border); }
[data-theme="dark"] .sidebar-cat-link { background: #1a1f2e; border-color: var(--border); }
[data-theme="dark"] .newsletter-form input { background: #1a1f2e; color: var(--dark-text); }

/* Smooth theme transition */
body, #header, .navbar, .post-card, .achievement-card,
.team-card, .contact-form-card, #site-footer,
.search-overlay, .about-hero, .blog-section,
.hero-slider-section, .cat-btn {
  transition: background var(--transition), color var(--transition),
              border-color var(--transition);
}

/* ── Dark Mode Toggle Button ── */
.theme-toggle {
  background: none; border: none; cursor: pointer;
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.1rem; color: var(--muted);
  transition: color var(--transition), background var(--transition);
  flex-shrink: 0;
}
.theme-toggle:hover { color: var(--primary); background: var(--light-bg); }
.theme-toggle .icon-sun  { display: none; }
.theme-toggle .icon-moon { display: block; }
[data-theme="dark"] .theme-toggle .icon-sun  { display: block; }
[data-theme="dark"] .theme-toggle .icon-moon { display: none; }
[data-theme="dark"] .theme-toggle { color: var(--accent); }

/* ===== Reset ===== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: var(--font-sans);
  color: var(--dark-text);
  background: var(--white);
  line-height: 1.7;
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}
img { max-width: 100%; height: auto; display: block; }
a { text-decoration: none; color: inherit; }
ul { list-style: none; }

/* ===== Custom Scrollbar ===== */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: var(--light-bg); }
::-webkit-scrollbar-thumb { background: var(--primary); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #2d5f8a; }

/* ================================================================
   HEADER
   ================================================================ */
#header {
  position: fixed; top: 0; left: 0; right: 0;
  z-index: 1000;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
  height: var(--header-height);
  display: flex; align-items: center;
  transition: box-shadow var(--transition), background var(--transition);
}
#header.sticked { box-shadow: 0 2px 24px rgba(0,0,0,0.10); }

.header-inner {
  max-width: 1200px; margin: 0 auto; padding: 0 24px;
  width: 100%; display: flex; align-items: center;
  justify-content: space-between; gap: 16px;
}
.logo {
  display: flex; align-items: center; gap: 10px;
  font-family: var(--font-serif); font-size: 1.1rem;
  font-weight: 700; color: var(--primary); flex-shrink: 0;
}
.navbar ul { display: flex; align-items: center; gap: 4px; }
.navbar a {
  padding: 8px 16px; font-size: 0.9rem; font-weight: 500;
  color: var(--dark-text); border-radius: 6px;
  transition: background var(--transition), color var(--transition);
  letter-spacing: 0.3px;
}
.navbar a:hover,
.navbar a.active { background: var(--primary); color: var(--white); }

.header-actions { display: flex; align-items: center; gap: 12px; }
.header-social a {
  color: var(--muted); font-size: 1.1rem;
  padding: 4px 6px; transition: color var(--transition);
}
.header-social a:hover { color: var(--primary); }

.search-toggle,
.mobile-nav-toggle {
  background: none; border: none; cursor: pointer;
  font-size: 1.1rem; padding: 6px;
  transition: color var(--transition); color: var(--muted);
}
.search-toggle:hover,
.mobile-nav-toggle:hover { color: var(--primary); }
.mobile-nav-toggle { display: none; font-size: 1.4rem; color: var(--dark-text); }

/* Search Overlay */
.search-overlay {
  position: fixed; top: var(--header-height); left: 0; right: 0;
  background: var(--white); border-bottom: 1px solid var(--border);
  padding: 16px 24px; z-index: 999; display: none;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}
.search-overlay.open { display: block; }
.search-overlay form {
  max-width: 600px; margin: 0 auto; display: flex; gap: 8px;
}
.search-overlay input {
  flex: 1; padding: 10px 16px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); font-size: 1rem; outline: none;
  transition: border-color var(--transition);
}
.search-overlay input:focus { border-color: var(--primary); }
.search-overlay button {
  padding: 10px 20px; background: var(--primary); color: var(--white);
  border: none; border-radius: var(--radius-sm); cursor: pointer;
  font-weight: 600; transition: background var(--transition);
}
.search-overlay button:hover { background: #2d5f8a; }

/* ================================================================
   HERO SLIDER
   ================================================================ */
main { padding-top: var(--header-height); min-height: 80vh; }
.container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

.hero-slider-section { background: #0d0d0d; }
.sliderFeaturedPosts { width: 100%; }

.slider-slide-link {
  display: block; height: 540px;
  position: relative; text-decoration: none; overflow: hidden;
}
.slider-bg-blur {
  position: absolute; inset: -24px;
  background-size: cover; background-position: center;
  filter: blur(20px) brightness(0.45) saturate(1.3);
  transform: scale(1.12); z-index: 0;
}
.slider-bg-main {
  position: absolute; inset: 0;
  background-size: contain; background-repeat: no-repeat;
  background-position: center; z-index: 1;
}
.slider-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(0deg, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.15) 55%, transparent 100%);
  display: flex; align-items: flex-end; padding: 48px; z-index: 2;
}
.slider-content { color: white; max-width: 700px; }
.slider-badge {
  display: inline-block; background: var(--accent); color: white;
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 1.5px; padding: 4px 14px; border-radius: 20px; margin-bottom: 14px;
}
.slider-content h2 {
  font-family: var(--font-serif);
  font-size: clamp(1.4rem, 3vw, 2.3rem);
  line-height: 1.3; margin-bottom: 18px;
  text-shadow: 0 2px 12px rgba(0,0,0,0.4);
}
.slider-read {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 0.9rem; font-weight: 600;
  color: rgba(255,255,255,0.92);
  border-bottom: 1px solid rgba(255,255,255,0.45);
  padding-bottom: 3px; transition: gap var(--transition);
}
.slider-slide-link:hover .slider-read { gap: 14px; }

.slider-empty,
.slider-placeholder {
  height: 540px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--primary), #2d5f8a);
  color: rgba(255,255,255,0.5);
}

.swiper-button-next,
.swiper-button-prev {
  color: white !important;
  background: rgba(0,0,0,0.35);
  width: 44px !important; height: 44px !important;
  border-radius: 50%; transition: background var(--transition);
}
.swiper-button-next:hover,
.swiper-button-prev:hover { background: rgba(0,0,0,0.6); }
.swiper-button-next::after,
.swiper-button-prev::after { font-size: 16px !important; }
.swiper-pagination-bullet-active { background: var(--accent) !important; }

/* ================================================================
   BLOG SECTION
   ================================================================ */
.blog-section { padding: 64px 0; background: var(--light-bg); }

.blog-section-header { text-align: center; margin-bottom: 48px; }
.blog-section-header .section-tag {
  display: inline-block; padding: 5px 18px;
  background: #deeaf7; color: var(--primary);
  border-radius: 20px; font-size: 0.78rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 14px;
}
.blog-section-header h2 {
  font-family: var(--font-serif);
  font-size: clamp(1.7rem, 3vw, 2.4rem);
  color: var(--dark-text); margin-bottom: 12px;
}
.blog-section-header p {
  color: var(--muted); max-width: 580px;
  margin: 0 auto; font-size: 0.95rem; line-height: 1.7;
}

.category-filter-bar {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding: 0 0 32px; justify-content: center;
}
.cat-btn {
  padding: 8px 20px; border-radius: 24px;
  border: 2px solid var(--border); background: var(--white);
  font-size: 0.85rem; font-weight: 500; color: var(--muted);
  cursor: pointer; transition: all var(--transition);
}
.cat-btn:hover { border-color: var(--primary); color: var(--primary); }
.cat-btn.active { background: var(--primary); border-color: var(--primary); color: var(--white); }

.blog-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
}

/* ── Post Card ── */
.post-card {
  background: var(--white);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border);
  cursor: pointer;
  display: flex; flex-direction: column; height: 100%;

  /* Hidden state — JS adds .show when card enters viewport */
  opacity: 0;
  transform: translateY(40px);
  transition: opacity 0.5s ease, transform 0.5s ease;
  will-change: opacity, transform;
}

/* Visible state — added by cardObserver */
.post-card.show {
  opacity: 1;
  transform: translateY(0);
}

/* Hover lift — only after card is visible */
.post-card.show:hover {
  transform: translateY(-6px) !important;
  box-shadow: var(--shadow-lg);
}

[data-theme="dark"] .post-card:hover { background: #181d28; }

/* Reduced motion — skip animation entirely */
@media (prefers-reduced-motion: reduce) {
  .post-card {
    opacity: 1 !important;
    transform: none !important;
    transition: none !important;
  }
}

.post-card-media {
  position: relative; width: 100%;
  aspect-ratio: 16 / 9; overflow: hidden;
  background: var(--light-bg); flex-shrink: 0;
}
.post-card-img {
  width: 100%; height: 100%; object-fit: cover;
  object-position: center top; display: block;
  transition: transform 0.5s ease;
}
.post-card:hover .post-card-img { transform: scale(1.05); }
.post-card-video { width: 100%; height: 100%; object-fit: cover; }
.post-card-img-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 3rem; color: var(--muted);
  background: linear-gradient(135deg, #e8e0d0, #d0c8b8);
}
.featured-badge {
  position: absolute; top: 12px; left: 12px;
  background: var(--accent); color: white;
  font-size: 0.68rem; font-weight: 700;
  padding: 4px 12px; border-radius: 20px;
  letter-spacing: 0.5px; text-transform: uppercase; z-index: 2;
}
.post-card-body {
  padding: 22px 24px 24px;
  display: flex; flex-direction: column; flex: 1;
}
.post-cat-badge {
  display: inline-block; background: #deeaf7; color: var(--primary);
  font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 1px; padding: 4px 12px; border-radius: 20px;
  margin-bottom: 12px; width: fit-content;
}
.post-card h3 {
  font-family: var(--font-serif); font-size: 1.08rem; line-height: 1.45;
  margin-bottom: 10px; color: var(--dark-text);
  display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
}
.post-card:hover h3 { color: var(--primary); }
.post-card p {
  font-size: 0.875rem; color: var(--muted); line-height: 1.65;
  margin-bottom: 0; display: -webkit-box; -webkit-line-clamp: 3;
  -webkit-box-orient: vertical; overflow: hidden; flex: 1;
}
.post-meta-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 0.78rem; color: var(--muted);
  border-top: 1px solid var(--border); padding-top: 14px; margin-top: 16px;
}
.read-more {
  color: var(--primary); font-weight: 600; font-size: 0.82rem;
  display: inline-flex; align-items: center; gap: 4px;
  transition: gap var(--transition);
}
.post-card:hover .read-more { gap: 8px; }

.load-more-wrap { text-align: center; margin-top: 44px; }
.btn-load-more {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 36px; border: 2px solid var(--primary);
  color: var(--primary); background: transparent;
  border-radius: 32px; font-weight: 600; font-size: 0.92rem;
  cursor: pointer; transition: all var(--transition);
}
.btn-load-more:hover {
  background: var(--primary); color: var(--white);
  transform: translateY(-2px); box-shadow: var(--shadow-md);
}

/* ================================================================
   LAYOUT WITH SIDEBAR (single post page)
   ================================================================ */
.layout-with-sidebar {
  display: grid; grid-template-columns: 1fr 300px;
  gap: 44px; align-items: start;
}
.post-main { padding: 48px 0; }
.back-link {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--muted); font-size: 0.88rem;
  margin-bottom: 24px; transition: color var(--transition);
}
.back-link:hover { color: var(--primary); }

.sidebar {
  position: sticky; top: calc(var(--header-height) + 24px); padding-top: 48px;
}
.sidebar-widget {
  background: var(--light-bg); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 24px; margin-bottom: 20px;
}
.sidebar-widget h4 {
  font-family: var(--font-serif); font-size: 1rem;
  color: var(--primary); margin-bottom: 16px;
  padding-bottom: 10px; border-bottom: 2px solid var(--border);
  display: flex; align-items: center; gap: 8px;
}
.recent-post-item {
  display: flex; gap: 12px; padding: 10px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer; transition: opacity var(--transition);
}
.recent-post-item:hover { opacity: 0.72; }
.recent-post-item:last-child { border-bottom: none; }
.recent-post-thumb {
  width: 60px; height: 60px; object-fit: cover;
  border-radius: var(--radius-sm); flex-shrink: 0;
}
.recent-post-thumb-placeholder {
  width: 60px; height: 60px; border-radius: var(--radius-sm);
  background: var(--border); display: flex;
  align-items: center; justify-content: center;
  color: var(--muted); flex-shrink: 0;
}
.recent-post-info h6 {
  font-size: 0.82rem; font-weight: 600; line-height: 1.4; margin-bottom: 4px;
}
.recent-post-info span { font-size: 0.75rem; color: var(--muted); }

.sidebar-cats { display: flex; flex-wrap: wrap; gap: 8px; }
.sidebar-cat-link {
  display: inline-block; padding: 5px 14px;
  background: var(--white); border: 1px solid var(--border);
  border-radius: 20px; font-size: 0.82rem; color: var(--primary);
  transition: all var(--transition);
}
.sidebar-cat-link:hover { background: var(--primary); color: var(--white); border-color: var(--primary); }

.newsletter-form { display: flex; flex-direction: column; gap: 10px; }
.newsletter-form input {
  padding: 10px 14px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); font-size: 0.9rem; outline: none;
  transition: border-color var(--transition);
}
.newsletter-form input:focus { border-color: var(--primary); }
.newsletter-form button {
  padding: 10px; background: var(--primary); color: var(--white);
  border: none; border-radius: var(--radius-sm); font-weight: 600;
  cursor: pointer; font-size: 0.9rem; transition: background var(--transition);
}
.newsletter-form button:hover { background: #2d5f8a; }

.social-links { display: flex; gap: 10px; flex-wrap: wrap; }
.social-link {
  width: 38px; height: 38px; border-radius: var(--radius-sm);
  background: var(--white); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  font-size: 1rem; color: var(--primary); transition: all var(--transition);
}
.social-link:hover { background: var(--primary); color: var(--white); }

/* ================================================================
   SINGLE POST
   ================================================================ */
.post-single-header h1 {
  font-family: var(--font-serif);
  font-size: clamp(1.6rem, 3vw, 2.5rem);
  line-height: 1.3; margin: 16px 0;
}
.post-single-img-wrap {
  position: relative; width: 100%; aspect-ratio: 16 / 9;
  border-radius: var(--radius-md); overflow: hidden;
  margin-bottom: 32px; background: #0d0d0d;
}
.post-single-img-blur {
  position: absolute; inset: -24px;
  background-size: cover; background-position: center;
  filter: blur(20px) brightness(0.45) saturate(1.3);
  transform: scale(1.12); z-index: 0;
}
.post-single-img {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: contain; object-position: center;
  z-index: 1; border-radius: 0; margin-bottom: 0; display: block;
}
.post-single-media { border-radius: var(--radius-md); margin-bottom: 28px; }
.post-single-content {
  font-size: 1.06rem; line-height: 1.95;
  color: #333; font-family: 'EB Garamond', Georgia, serif;
}
[data-theme="dark"] .post-single-content { color: #e8e6e1; }
.post-single-content p { margin-bottom: 22px; }
.share-row {
  margin-top: 28px; padding-top: 20px;
  border-top: 1px solid var(--border);
  display: flex; align-items: center; gap: 16px;
}
.share-row strong { font-size: 0.88rem; color: var(--muted); }

/* ================================================================
   COMMENTS
   ================================================================ */
.comments-section {
  margin-top: 48px; padding-top: 32px; border-top: 2px solid var(--border);
}
.comments-section h3 {
  font-family: var(--font-serif); font-size: 1.4rem;
  margin-bottom: 24px; color: var(--primary);
}
.comment-item {
  background: var(--light-bg); border-radius: 10px;
  padding: 18px; margin-bottom: 14px;
}
.comment-author { font-weight: 600; font-size: 0.92rem; color: var(--primary); }
.comment-date { font-size: 0.78rem; color: var(--muted); }
.comment-item p { margin-top: 8px; font-size: 0.95rem; }
.comment-form { margin-top: 32px; }
.comment-form h4 { font-family: var(--font-serif); font-size: 1.2rem; margin-bottom: 20px; }

/* ================================================================
   FORMS
   ================================================================ */
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.form-group label { font-size: 0.88rem; font-weight: 500; }
.form-group input,
.form-group textarea,
.form-group select {
  padding: 10px 14px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); font-size: 0.95rem;
  font-family: var(--font-sans); outline: none;
  transition: border-color var(--transition);
}
.form-group input:focus,
.form-group textarea:focus { border-color: var(--primary); }
.form-group textarea { resize: vertical; min-height: 130px; }

/* ================================================================
   BUTTONS
   ================================================================ */
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 26px; border-radius: var(--radius-sm);
  font-weight: 600; font-size: 0.92rem;
  cursor: pointer; border: none; transition: all var(--transition);
}
.btn-primary { background: var(--primary); color: var(--white); }
.btn-primary:hover { background: #2d5f8a; transform: translateY(-2px); box-shadow: var(--shadow-md); }
.btn-outline { background: transparent; color: var(--primary); border: 2px solid var(--primary); }
.btn-outline:hover { background: var(--primary); color: var(--white); }

/* ================================================================
   ALERTS
   ================================================================ */
.alert { padding: 12px 16px; border-radius: var(--radius-sm); font-size: 0.9rem; margin-top: 12px; display: none; }
.alert.show { display: block; }
.alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
.alert-error   { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }

/* ================================================================
   SPINNERS & LOADING
   ================================================================ */
.spinner {
  width: 20px; height: 20px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: white; border-radius: 50%;
  animation: spin 0.6s linear infinite; display: inline-block;
}
.spinner-sm {
  width: 20px; height: 20px; border: 2px solid var(--border);
  border-top-color: var(--primary); border-radius: 50%;
  animation: spin 0.6s linear infinite; display: block;
}
.spinner-lg {
  width: 40px; height: 40px; border: 3px solid var(--border);
  border-top-color: var(--primary); border-radius: 50%;
  animation: spin 0.7s linear infinite; display: block; margin: 0 auto 14px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.loading-posts { text-align: center; padding: 64px 20px; color: var(--muted); }
.no-posts {
  text-align: center; padding: 64px 20px; color: var(--muted);
  display: flex; flex-direction: column; align-items: center;
}
.no-posts i { font-size: 3.2rem; margin-bottom: 16px; opacity: 0.5; }

/* ================================================================
   ABOUT PAGE — HERO
   ================================================================ */
.about-hero {
  background: linear-gradient(135deg, var(--primary) 0%, #2d5f8a 100%);
  color: white; padding: 72px 0; text-align: center;
}
.about-hero h1 {
  font-family: var(--font-serif);
  font-size: clamp(2rem, 4vw, 3rem); margin-bottom: 14px;
}
.about-hero p { opacity: 0.88; max-width: 600px; margin: 0 auto; font-size: 1.05rem; }

/* ================================================================
   PROFILE SECTION
   ================================================================ */
.profile-section { padding: 72px 0; }
.profile-grid { display: grid; grid-template-columns: 340px 1fr; gap: 52px; align-items: start; }
.profile-img { border-radius: var(--radius-lg); width: 100%; object-fit: cover; box-shadow: var(--shadow-lg); }
.profile-content h2 { font-family: var(--font-serif); font-size: 2rem; color: var(--primary); margin-bottom: 8px; }
.title-badge {
  display: inline-block; background: var(--accent); color: white;
  padding: 5px 18px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; margin-bottom: 22px;
}
.profile-content p { font-size: 1rem; line-height: 1.88; color: #444; margin-bottom: 16px; }

/* ================================================================
   ACHIEVEMENTS GRID
   ================================================================ */
.achievements-section { padding: 64px 0; background: var(--white); }
.achievements-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 40px; }
.achievement-card {
  background: var(--light-bg); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 28px;
  transition: transform var(--transition), box-shadow var(--transition);
  animation: fadeIn 0.7s ease both;
}
.achievement-card:hover { transform: translateY(-5px); box-shadow: var(--shadow-md); }
.achievement-icon { font-size: 2.2rem; margin-bottom: 14px; }
.achievement-card h4 { font-size: 1rem; color: var(--primary); margin-bottom: 8px; font-weight: 700; }
.achievement-card p { font-size: 0.88rem; color: var(--muted); line-height: 1.65; }

/* ================================================================
   TEAM SECTION
   ================================================================ */
.team-section { background: var(--light-bg); padding: 72px 0; }
.team-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-top: 36px; }
.team-card {
  background: var(--white); border-radius: var(--radius-md); padding: 30px 20px 26px;
  text-align: center; border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  transition: transform var(--transition), box-shadow var(--transition);
  animation: fadeIn 0.7s ease both;
}
.team-card:hover { transform: translateY(-6px); box-shadow: var(--shadow-md); }
.team-img-wrap {
  width: 110px; height: 110px; border-radius: 50%; margin: 0 auto 18px;
  overflow: hidden; border: 3px solid var(--border); box-shadow: 0 4px 16px rgba(0,0,0,0.10);
}
.team-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; transition: transform 0.4s ease; }
.team-card:hover .team-img { transform: scale(1.07); }
.team-card h5 { font-family: var(--font-serif); font-size: 1rem; font-weight: 700; color: var(--primary); margin-bottom: 6px; }
.team-card span { font-size: 0.76rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 500; }

/* ================================================================
   SECTION HEADERS (reusable)
   ================================================================ */
.section-header { text-align: center; margin-bottom: 44px; }
.section-header .section-tag {
  display: inline-block; padding: 5px 18px; background: #deeaf7; color: var(--primary);
  border-radius: 20px; font-size: 0.78rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 14px;
}
.section-header h2 {
  font-family: var(--font-serif); font-size: clamp(1.6rem, 3vw, 2.3rem);
  color: var(--primary); margin-bottom: 12px;
}
.section-header p { color: var(--muted); max-width: 600px; margin: 0 auto; font-size: 0.95rem; }

/* ================================================================
   CONTACT PAGE
   ================================================================ */
.contact-section { padding: 72px 0; }
.contact-grid { display: grid; grid-template-columns: 1fr 1.6fr; gap: 52px; }
.contact-info h2 { font-family: var(--font-serif); font-size: 1.9rem; color: var(--primary); margin-bottom: 16px; }
.contact-info p { color: var(--muted); margin-bottom: 28px; line-height: 1.75; }
.contact-item { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 22px; }
.contact-icon {
  width: 46px; height: 46px; background: var(--primary); color: white;
  border-radius: 10px; display: flex; align-items: center; justify-content: center;
  font-size: 1.1rem; flex-shrink: 0;
}
.contact-item h5 { font-size: 0.82rem; color: var(--muted); margin-bottom: 4px; }
.contact-item p { font-size: 0.95rem; color: var(--dark-text); margin: 0; }
.contact-form-card {
  background: var(--light-bg); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 40px; box-shadow: var(--shadow-sm);
}
.contact-form-card h3 { font-family: var(--font-serif); font-size: 1.5rem; margin-bottom: 28px; color: var(--primary); }
.testimonials-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px; margin-top: 32px;
}

/* ================================================================
   FOOTER
   ================================================================ */
footer { background: var(--primary); color: rgba(255,255,255,0.82); padding: 52px 0 24px; }
.footer-inner { display: grid; grid-template-columns: 1.6fr 1fr 1.2fr 1.2fr; gap: 36px; margin-bottom: 36px; }
.footer-brand h3 { font-family: var(--font-serif); font-size: 1.3rem; color: white; margin-bottom: 14px; }
.footer-brand p { font-size: 0.88rem; line-height: 1.75; }
.footer-col h4 { color: white; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 18px; }
.footer-col ul li { margin-bottom: 10px; }
.footer-col a { font-size: 0.88rem; opacity: 0.8; transition: opacity var(--transition); }
.footer-col a:hover { opacity: 1; }

.footer-recent li { margin-bottom: 14px; }
.footer-recent-item { display: flex; align-items: center; gap: 12px; }
.footer-recent-item img { width: 50px; height: 42px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
.footer-recent-item div { display: flex; flex-direction: column; gap: 3px; }
.footer-post-date { font-size: 0.72rem; opacity: 0.6; }
.footer-post-title { font-size: 0.82rem; opacity: 0.88; line-height: 1.4; }

.newsletter-footer-form { display: flex; gap: 8px; margin-top: 4px; }
.newsletter-footer-form input {
  flex: 1; padding: 9px 12px; border: 1px solid rgba(255,255,255,0.22);
  border-radius: var(--radius-sm); background: rgba(255,255,255,0.10);
  color: white; font-size: 0.88rem; outline: none; transition: border-color var(--transition);
}
.newsletter-footer-form input::placeholder { color: rgba(255,255,255,0.5); }
.newsletter-footer-form input:focus { border-color: rgba(255,255,255,0.5); }
.newsletter-footer-form button {
  padding: 9px 18px; background: var(--accent); color: white; border: none;
  border-radius: var(--radius-sm); font-weight: 700; font-size: 0.85rem;
  cursor: pointer; white-space: nowrap; transition: background var(--transition);
}
.newsletter-footer-form button:hover { background: #b8841a; }

.footer-bottom {
  border-top: 1px solid rgba(255,255,255,0.15); padding-top: 22px;
  display: flex; justify-content: space-between; align-items: center;
  font-size: 0.82rem; opacity: 0.75;
}
.footer-social { display: flex; gap: 14px; }
.footer-social a {
  color: rgba(255,255,255,0.72); font-size: 1.1rem;
  transition: color var(--transition), transform var(--transition);
}
.footer-social a:hover { color: white; transform: translateY(-2px); }

/* ================================================================
   SCROLL TOP
   ================================================================ */
.scroll-top {
  position: fixed; bottom: 28px; right: 28px;
  width: 46px; height: 46px; background: var(--primary); color: white;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 1.2rem; opacity: 0; pointer-events: none;
  transition: opacity var(--transition), transform var(--transition);
  box-shadow: var(--shadow-md); z-index: 900;
}
.scroll-top.visible { opacity: 1; pointer-events: all; }
.scroll-top:hover { transform: translateY(-3px); }

/* ================================================================
   ANIMATIONS
   ================================================================ */
.page-fade { animation: fadeIn 0.45s ease; }
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ================================================================
   MOBILE NAV OVERLAY
   ================================================================ */
.nav-overlay {
  display: none; position: fixed; top: 0; left: 0;
  width: 100vw; height: 100vh; height: 100dvh;
  background: rgba(0,0,0,0.48); z-index: 997;
  backdrop-filter: blur(3px); animation: fadeOverlay 0.25s ease;
}
.nav-overlay.open { display: block; }
@keyframes fadeOverlay { from { opacity: 0; } to { opacity: 1; } }

/* ================================================================
   COOKIE CONSENT BANNER
   ================================================================ */
#cookie-banner {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
  background: #111827; color: #e5e7eb;
  padding: 16px 24px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
  box-shadow: 0 -4px 20px rgba(0,0,0,0.35);
  transform: translateY(100%); transition: transform 0.4s ease;
}
#cookie-banner.show { transform: translateY(0); }
#cookie-banner p { margin: 0; font-size: 0.875rem; flex: 1; min-width: 200px; line-height: 1.6; }
#cookie-banner a { color: #93c5fd; text-decoration: underline; }
.cookie-btns { display: flex; gap: 10px; flex-shrink: 0; }
.cookie-btn-accept {
  background: var(--primary); color: #fff; border: none;
  padding: 9px 22px; border-radius: 6px; cursor: pointer;
  font-size: 0.85rem; font-weight: 600; transition: background var(--transition);
}
.cookie-btn-accept:hover { background: #2d5f8a; }
.cookie-btn-decline {
  background: transparent; color: #9ca3af; border: 1px solid #4b5563;
  padding: 9px 16px; border-radius: 6px; cursor: pointer; font-size: 0.85rem;
  transition: border-color var(--transition), color var(--transition);
}
.cookie-btn-decline:hover { border-color: #9ca3af; color: #e5e7eb; }

/* ================================================================
   LAZY IMAGES
   ================================================================ */
img.lazy-img { transition: opacity 0.4s ease; }
img.lazy-img.skeleton { opacity: 0; }
img.lazy-img:not(.skeleton) { opacity: 1; }

/* ================================================================
   SKELETON SHIMMER
   ================================================================ */
.skeleton {
  animation: shimmer 1.6s infinite linear;
  background: linear-gradient(90deg, var(--border) 25%, color-mix(in srgb, var(--border) 50%, white) 50%, var(--border) 75%);
  background-size: 200% 100%;
  border-radius: var(--radius-sm);
  display: block;
}
[data-theme="dark"] .skeleton {
  background: linear-gradient(90deg, #1e2535 25%, #2a3348 50%, #1e2535 75%);
  background-size: 200% 100%;
}
@keyframes shimmer {
  0%   { background-position:  200% 0; }
  100% { background-position: -200% 0; }
}

/* ================================================================
   RESPONSIVE — 1280px
   ================================================================ */
@media (max-width: 1280px) {
  .blog-grid { grid-template-columns: repeat(3, 1fr); }
  .achievements-grid { grid-template-columns: repeat(3, 1fr); }
}

/* ================================================================
   RESPONSIVE — 1024px
   ================================================================ */
@media (max-width: 1024px) {
  .blog-grid { grid-template-columns: repeat(2, 1fr); }
  .footer-inner { grid-template-columns: 1fr 1fr; gap: 28px; }
  .achievements-grid { grid-template-columns: repeat(2, 1fr); }
  .team-grid { grid-template-columns: repeat(3, 1fr); }
  .profile-grid { grid-template-columns: 280px 1fr; gap: 36px; }
}

@media (max-width: 600px) {
  .blog-grid { grid-template-columns: 1fr; }
}

/* ================================================================
   RESPONSIVE — 768px
   ================================================================ */
@media (max-width: 768px) {
  .mobile-nav-toggle {
    display: flex; align-items: center; justify-content: center;
    width: 42px; height: 42px; background: none; border: none;
    cursor: pointer; font-size: 1.5rem; color: var(--dark-text);
    border-radius: 8px; transition: background var(--transition); flex-shrink: 0;
  }
  .mobile-nav-toggle:hover { background: var(--light-bg); }

  .navbar {
    position: fixed; top: 0; right: 0;
    width: min(300px, 82vw); height: 100vh; height: 100dvh;
    background: var(--white); z-index: 998;
    transform: translateX(100%);
    transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
    display: flex; flex-direction: column;
    box-shadow: -6px 0 28px rgba(0,0,0,0.16);
    overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch;
  }
  .navbar.open { transform: translateX(0); }

  .navbar::before {
    content: "Menu"; display: block; padding: 22px 24px 16px;
    font-family: var(--font-serif); font-size: 1.15rem; font-weight: 700;
    color: var(--primary); border-bottom: 1px solid var(--border);
  }
  .navbar ul { flex-direction: column; gap: 0; padding: 12px 0; flex: 1; }
  .navbar ul li { width: 100%; }
  .navbar a {
    display: flex; align-items: center; padding: 14px 24px;
    font-size: 1rem; font-weight: 500; border-radius: 0;
    border-left: 3px solid transparent;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .navbar a:hover { background: var(--light-bg); color: var(--primary); border-left-color: var(--accent); }
  .navbar a.active { background: #deeaf7; color: var(--primary); border-left-color: var(--primary); font-weight: 600; }
  .navbar::after { content: ""; display: block; height: 1px; background: var(--border); margin: 8px 24px; }

  .nav-social { padding: 16px 24px 28px; display: flex; gap: 12px; }
  .nav-social a {
    width: 38px; height: 38px; background: var(--light-bg); border: 1px solid var(--border);
    border-radius: 8px; display: flex; align-items: center; justify-content: center;
    color: var(--primary); font-size: 1rem; transition: all var(--transition);
  }
  .nav-social a:hover { background: var(--primary); color: white; }

  .header-social { display: none; }

  .swiper-button-next, .swiper-button-prev { width: 34px !important; height: 34px !important; }
  .swiper-button-next::after, .swiper-button-prev::after { font-size: 12px !important; }

  .slider-slide-link { height: 340px; }
  .slider-overlay { padding: 24px; }
  .slider-content h2 { font-size: 1.15rem; }

  .blog-grid { grid-template-columns: 1fr; }
  .category-filter-bar { justify-content: flex-start; }

  .profile-grid { grid-template-columns: 1fr !important; gap: 28px; }
  .profile-grid > div:last-child { order: -1; }
  .profile-img { max-width: 100%; width: 100%; height: 300px; object-fit: cover; border-radius: var(--radius-md); }

  .achievements-grid { grid-template-columns: 1fr; }
  .team-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .layout-with-sidebar { grid-template-columns: 1fr; }
  .sidebar { position: static; padding-top: 0; }
  .contact-grid { grid-template-columns: 1fr; }
  .contact-form-card { padding: 28px; }
  .form-row { grid-template-columns: 1fr; }
  .footer-inner { grid-template-columns: 1fr; gap: 24px; }
  .footer-bottom { flex-direction: column; gap: 12px; text-align: center; }
}

/* ================================================================
   RESPONSIVE — 480px
   ================================================================ */
@media (max-width: 480px) {
  .container { padding: 0 16px; }
  .header-inner { padding: 0 16px; }
  .slider-slide-link { height: 260px; }
  .slider-content h2 { font-size: 1rem; }
  .slider-overlay { padding: 16px; }
  .slider-badge { font-size: 0.65rem; }
  .blog-section { padding: 40px 0; }
  .blog-section-header { margin-bottom: 32px; }
  .category-filter-bar { gap: 6px; padding-bottom: 20px; }
  .cat-btn { padding: 6px 14px; font-size: 0.78rem; }
  .achievements-grid { grid-template-columns: 1fr; gap: 16px; }
  .team-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .team-img-wrap { width: 80px; height: 80px; }
  .team-card { padding: 20px 12px 18px; }
  .team-card h5 { font-size: 0.88rem; }
  .contact-form-card { padding: 20px; }
  .newsletter-footer-form { flex-direction: column; }
  .newsletter-footer-form button { width: 100%; }
  #cookie-banner { flex-direction: column; align-items: flex-start; }
  .cookie-btns { width: 100%; }
  .cookie-btn-accept { flex: 1; text-align: center; }
}

@media (max-width: 425px) {
  #site-logo-text { display: none; }
}
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Post Editor — Admin</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <style>
    :root {
      --primary:#1a3c5e; --accent:#c8971f; --green:#2a7a4b;
      --red:#dc3545; --border:#e5ddd0; --muted:#6c757d;
      --light:#f9f5ef; --white:#fff; --radius:10px;
    }
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Inter',sans-serif;background:#f4f6f9;color:#1a1a1a;}

    /* ── Layout ── */
    .admin-wrap{display:flex;min-height:100vh;}
    .sidebar{width:240px;background:var(--primary);color:#fff;padding:24px 0;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;}
    .sidebar-brand{padding:0 20px 24px;font-size:1rem;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.12);margin-bottom:12px;}
    .sidebar a{display:flex;align-items:center;gap:10px;padding:11px 20px;color:rgba(255,255,255,0.78);text-decoration:none;font-size:0.9rem;transition:background .2s,color .2s;}
    .sidebar a:hover,.sidebar a.active{background:rgba(255,255,255,0.12);color:#fff;}
    .main{flex:1;padding:32px;max-width:900px;}

    /* ── Page header ── */
    .page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;}
    .page-header h1{font-size:1.5rem;color:var(--primary);}

    /* ── Meta fields ── */
    .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;}
    .form-group{display:flex;flex-direction:column;gap:6px;}
    .form-group label{font-size:0.83rem;font-weight:600;color:var(--muted);}
    .form-group input,.form-group select,.form-group textarea{
      padding:10px 14px;border:1px solid var(--border);border-radius:8px;
      font-size:0.93rem;font-family:inherit;outline:none;
      transition:border-color .2s;background:var(--white);
    }
    .form-group input:focus,.form-group select:focus,.form-group textarea:focus{border-color:var(--primary);}
    .form-group textarea{resize:vertical;min-height:80px;}
    .full-width{grid-column:1/-1;}

    /* ── Block editor ── */
    .editor-label{
      font-size:0.83rem;font-weight:700;color:var(--primary);
      text-transform:uppercase;letter-spacing:0.8px;
      margin-bottom:12px;display:flex;align-items:center;gap:8px;
    }
    #blocks-container{display:flex;flex-direction:column;gap:12px;margin-bottom:16px;}

    /* Individual block card */
    .block-card{
      background:var(--white);border:1px solid var(--border);
      border-radius:var(--radius);overflow:hidden;
      transition:box-shadow .2s;
    }
    .block-card:hover{box-shadow:0 4px 16px rgba(0,0,0,0.08);}
    .block-card.block-text  {border-left:4px solid var(--primary);}
    .block-card.block-image {border-left:4px solid var(--accent);}
    .block-card.block-video {border-left:4px solid var(--green);}

    .block-header{
      display:flex;align-items:center;justify-content:space-between;
      padding:10px 16px;background:#fafafa;border-bottom:1px solid var(--border);
      gap:8px;
    }
    .block-type-label{
      font-size:0.75rem;font-weight:700;text-transform:uppercase;
      letter-spacing:0.8px;display:flex;align-items:center;gap:6px;
    }
    .block-card.block-text  .block-type-label{color:var(--primary);}
    .block-card.block-image .block-type-label{color:var(--accent);}
    .block-card.block-video .block-type-label{color:var(--green);}

    .block-controls{display:flex;gap:4px;}
    .block-btn{
      background:none;border:none;cursor:pointer;padding:5px 8px;
      border-radius:6px;font-size:0.85rem;color:var(--muted);
      transition:background .15s,color .15s;
    }
    .block-btn:hover{background:var(--light);color:var(--primary);}
    .block-btn.del:hover{background:#fde8ea;color:var(--red);}

    .block-body{padding:14px 16px;}

    /* ── Markdown toolbar ── */
    .md-toolbar{
      display:flex;gap:4px;flex-wrap:wrap;
      padding:6px 8px;background:#f0f4f8;
      border:1px solid var(--border);border-bottom:none;
      border-radius:8px 8px 0 0;
    }
    .md-btn{
      background:var(--white);border:1px solid var(--border);
      border-radius:5px;padding:4px 8px;
      font-size:0.78rem;font-weight:700;cursor:pointer;
      color:var(--primary);transition:all .15s;
      display:inline-flex;align-items:center;gap:3px;
      font-family: 'Georgia', serif;
    }
    .md-btn:hover{background:var(--primary);color:#fff;border-color:var(--primary);}
    .md-btn.md-sep{background:none;border:none;color:var(--border);cursor:default;padding:4px 2px;}
    .md-hint{
      font-size:0.72rem;color:var(--muted);margin-top:6px;
      display:flex;align-items:center;gap:6px;flex-wrap:wrap;
    }
    .md-hint code{
      background:#f0f4f8;padding:1px 5px;border-radius:3px;
      font-size:0.7rem;color:var(--primary);
    }

    /* Text block textarea — connects flush to toolbar */
    .block-textarea{
      width:100%;min-height:160px;padding:10px 14px;
      border:1px solid var(--border);border-radius:0 0 8px 8px;
      font-size:0.95rem;line-height:1.75;font-family:'Georgia',serif;
      resize:vertical;outline:none;transition:border-color .2s;
    }
    .block-textarea:focus{border-color:var(--primary);}

    /* Preview toggle */
    .md-preview-toggle{
      display:flex;gap:0;border:1px solid var(--border);border-radius:6px;overflow:hidden;margin-left:auto;
    }
    .md-preview-toggle button{
      padding:4px 12px;font-size:0.75rem;font-weight:600;border:none;cursor:pointer;
      background:var(--white);color:var(--muted);transition:all .15s;
    }
    .md-preview-toggle button.active{background:var(--primary);color:#fff;}
    .md-preview-box{
      min-height:120px;padding:10px 14px;
      border:1px solid var(--border);border-radius:0 0 8px 8px;
      font-size:0.95rem;line-height:1.75;
      background:#fefefe;display:none;
    }
    .md-preview-box.show{display:block;}

    /* Image block */
    .img-upload-area{
      border:2px dashed var(--border);border-radius:8px;
      padding:20px;text-align:center;cursor:pointer;
      transition:border-color .2s,background .2s;position:relative;
    }
    .img-upload-area:hover{border-color:var(--accent);background:#fffbf0;}
    .img-upload-area input[type=file]{
      position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;
    }
    .img-upload-area .upload-icon{font-size:2rem;color:var(--muted);margin-bottom:8px;}
    .img-upload-area p{font-size:0.85rem;color:var(--muted);}
    .img-preview{
      max-height:200px;border-radius:8px;object-fit:cover;
      width:100%;margin-top:10px;display:none;
    }
    .img-caption-input{
      width:100%;margin-top:10px;padding:8px 12px;
      border:1px solid var(--border);border-radius:6px;
      font-size:0.85rem;font-family:inherit;outline:none;
    }
    .img-caption-input:focus{border-color:var(--accent);}

    /* Video block */
    .video-type-tabs{display:flex;gap:8px;margin-bottom:12px;}
    .vtab{
      padding:6px 18px;border-radius:20px;border:2px solid var(--border);
      background:var(--white);font-size:0.82rem;font-weight:600;
      color:var(--muted);cursor:pointer;transition:all .2s;
    }
    .vtab.active{background:var(--green);border-color:var(--green);color:#fff;}
    .video-youtube-input,.video-file-input{display:none;}
    .video-youtube-input.show,.video-file-input.show{display:block;}
    .video-url-field{
      width:100%;padding:10px 14px;border:1px solid var(--border);
      border-radius:8px;font-size:0.93rem;outline:none;
      transition:border-color .2s;
    }
    .video-url-field:focus{border-color:var(--green);}
    .video-file-area{
      border:2px dashed var(--border);border-radius:8px;
      padding:20px;text-align:center;cursor:pointer;
      transition:border-color .2s;position:relative;
    }
    .video-file-area:hover{border-color:var(--green);}
    .video-file-area input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;}
    .video-file-name{font-size:0.85rem;color:var(--green);margin-top:6px;font-weight:600;}

    /* ── Add block buttons ── */
    .add-block-bar{
      display:flex;gap:10px;flex-wrap:wrap;
      padding:16px;background:var(--light);
      border:1px dashed var(--border);border-radius:var(--radius);
      margin-bottom:28px;
    }
    .add-block-bar span{font-size:0.8rem;color:var(--muted);font-weight:600;align-self:center;margin-right:4px;}
    .add-btn{
      display:inline-flex;align-items:center;gap:6px;
      padding:8px 18px;border-radius:8px;border:none;
      font-size:0.83rem;font-weight:700;cursor:pointer;
      transition:all .2s;
    }
    .add-btn-text {background:#deeaf7;color:var(--primary);}
    .add-btn-text:hover{background:var(--primary);color:#fff;}
    .add-btn-image{background:#fff4e0;color:var(--accent);}
    .add-btn-image:hover{background:var(--accent);color:#fff;}
    .add-btn-video{background:#e6f4ed;color:var(--green);}
    .add-btn-video:hover{background:var(--green);color:#fff;}

    /* ── Cover image ── */
    .cover-section{
      background:var(--white);border:1px solid var(--border);
      border-radius:var(--radius);padding:20px;margin-bottom:24px;
    }
    .cover-section h3{font-size:0.95rem;color:var(--primary);margin-bottom:14px;font-weight:700;}
    .cover-preview{max-height:160px;border-radius:8px;object-fit:cover;width:100%;display:none;margin-top:10px;}

    /* ── Submit bar ── */
    .submit-bar{
      display:flex;gap:12px;align-items:center;
      padding:20px;background:var(--white);
      border:1px solid var(--border);border-radius:var(--radius);
      margin-top:8px;
    }
    .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 26px;border-radius:8px;font-weight:700;font-size:0.92rem;cursor:pointer;border:none;transition:all .2s;}
    .btn-primary{background:var(--primary);color:#fff;}
    .btn-primary:hover{background:#2d5f8a;transform:translateY(-1px);}
    .btn-primary:disabled{opacity:.6;cursor:not-allowed;transform:none;}
    .btn-outline{background:transparent;color:var(--muted);border:2px solid var(--border);}
    .btn-outline:hover{border-color:var(--muted);}
    .btn-featured{background:#fff4e0;color:var(--accent);border:2px solid var(--accent);}
    .btn-featured.on{background:var(--accent);color:#fff;}

    /* ── Toast ── */
    #toast{
      position:fixed;bottom:28px;right:28px;z-index:9999;
      color:#fff;padding:12px 22px;border-radius:8px;
      font-size:0.88rem;font-weight:500;pointer-events:none;
      opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s;
    }
    #toast.show{opacity:1;transform:translateY(0);}
    #toast.success{background:var(--green);}
    #toast.error{background:var(--red);}

    .spinner-inline{
      width:18px;height:18px;border:2px solid rgba(255,255,255,0.4);
      border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block;
    }
    @keyframes spin{to{transform:rotate(360deg);}}

    /* Inline markdown preview styles */
    .md-preview-box h1{font-size:1.6rem;margin-bottom:12px;color:#1a1a1a;}
    .md-preview-box h2{font-size:1.3rem;margin-bottom:10px;color:#1a1a1a;}
    .md-preview-box h3{font-size:1.1rem;margin-bottom:8px;color:#1a1a1a;}
    .md-preview-box p{margin-bottom:12px;line-height:1.75;}
    .md-preview-box strong{font-weight:700;}
    .md-preview-box em{font-style:italic;}
    .md-preview-box ul,.md-preview-box ol{margin:0 0 12px 24px;}
    .md-preview-box li{margin-bottom:4px;line-height:1.6;}
    .md-preview-box blockquote{border-left:4px solid #c8971f;padding:8px 16px;background:#fffbf0;margin:12px 0;color:#555;font-style:italic;}
    .md-preview-box code{background:#f0f4f8;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:0.88em;}
    .md-preview-box pre{background:#1a1a2e;color:#e0e0e0;padding:14px;border-radius:8px;margin:12px 0;overflow-x:auto;}
    .md-preview-box pre code{background:none;padding:0;color:inherit;}
    .md-preview-box hr{border:none;border-top:2px solid var(--border);margin:20px 0;}
    .md-preview-box a{color:var(--primary);text-decoration:underline;}
  </style>
</head>
<body>
<div class="admin-wrap">

  <aside class="sidebar">
    <div class="sidebar-brand"><i class="bi bi-person-badge"></i> Admin Panel</div>
    <a href="/admin/dashboard"><i class="bi bi-speedometer2"></i> Dashboard</a>
    <a href="/admin/posts" class="active"><i class="bi bi-file-earmark-text"></i> Posts</a>
    <a href="/admin/comments"><i class="bi bi-chat-left-text"></i> Comments</a>
    <a href="/admin/messages"><i class="bi bi-envelope"></i> Messages</a>
    <a href="/admin/subscribers"><i class="bi bi-people"></i> Subscribers</a>
    <a href="/admin/settings"><i class="bi bi-gear"></i> Settings</a>
    <a href="/admin/about"><i class="bi bi-person"></i> About Page</a>
    <a href="/" target="_blank"><i class="bi bi-box-arrow-up-right"></i> View Site</a>
  </aside>

  <div class="main">
    <div class="page-header">
      <h1 id="page-title"><i class="bi bi-plus-circle"></i> New Post</h1>
      <a href="/admin/posts" class="btn btn-outline"><i class="bi bi-arrow-left"></i> Back</a>
    </div>

    <!-- ── Meta ── -->
    <div class="meta-grid">
      <div class="form-group full-width">
        <label>Post Title *</label>
        <input type="text" id="post-title" placeholder="Enter post title…">
      </div>
      <div class="form-group full-width">
        <label>Excerpt / Summary *</label>
        <textarea id="post-excerpt" rows="2" placeholder="Short summary shown on the blog grid…"></textarea>
      </div>
      <div class="form-group">
        <label>Category *</label>
        <input type="text" id="post-category" placeholder="e.g. Legislation, Community…">
      </div>
      <div class="form-group">
        <label>Date (leave blank for today)</label>
        <input type="text" id="post-date" placeholder="e.g. 13 March 2026">
      </div>
    </div>

    <!-- ── Cover image ── -->
    <div class="cover-section">
      <h3><i class="bi bi-image"></i> Cover Image <span style="font-weight:400;color:var(--muted)">(shown on blog grid & slider)</span></h3>
      <div class="img-upload-area" id="cover-drop">
        <input type="file" id="cover-file" accept="image/*">
        <div class="upload-icon"><i class="bi bi-cloud-arrow-up"></i></div>
        <p>Click to upload cover image</p>
      </div>
      <img class="cover-preview" id="cover-preview" alt="Cover preview">
    </div>

    <!-- ── Block editor ── -->
    <div class="editor-label">
      <i class="bi bi-layout-text-sidebar"></i> Post Body
      <span style="font-weight:400;color:var(--muted);text-transform:none;letter-spacing:0;font-size:0.8rem">
        — add text and media blocks in any order · text blocks support Markdown
      </span>
    </div>

    <div id="blocks-container"></div>

    <!-- Add block buttons -->
    <div class="add-block-bar">
      <span>Insert:</span>
      <button class="add-btn add-btn-text"  onclick="addBlock('text')">
        <i class="bi bi-text-left"></i> Text
      </button>
      <button class="add-btn add-btn-image" onclick="addBlock('image')">
        <i class="bi bi-image"></i> Image
      </button>
      <button class="add-btn add-btn-video" onclick="addBlock('video')">
        <i class="bi bi-play-circle"></i> Video
      </button>
    </div>

    <!-- ── Submit ── -->
    <div class="submit-bar">
      <button class="btn btn-primary" id="save-btn" onclick="savePost()">
        <i class="bi bi-cloud-upload"></i> Publish Post
      </button>
      <button class="btn btn-featured" id="featured-btn" onclick="toggleFeatured()">
        <i class="bi bi-star"></i> Featured
      </button>
      <span id="save-status" style="font-size:0.85rem;color:var(--muted)"></span>
    </div>
  </div>
</div>

<div id="toast"></div>

<!-- marked.js for live preview only (no server dependency) -->
<script src="https://cdn.jsdelivr.net/npm/marked@9/marked.min.js"></script>
<script>
// ── State ──────────────────────────────────────────────────────────────────────
let blocks    = [];
let featured  = false;
let editingId = null;
let blockIdx  = 0;

// ── Init ───────────────────────────────────────────────────────────────────────
(async function init() {
  const path  = window.location.pathname;
  const match = path.match(/\/admin\/posts\/edit\/([^/]+)/);

  if (match) {
    editingId = match[1];
    document.getElementById('page-title').innerHTML = '<i class="bi bi-pencil"></i> Edit Post';
    document.getElementById('save-btn').innerHTML   = '<i class="bi bi-cloud-upload"></i> Update Post';
    await loadExistingPost(editingId);
  } else {
    addBlock('text');
  }

  document.getElementById('cover-file').addEventListener('change', function () {
    previewCoverFile(this);
  });
})();

async function loadExistingPost(id) {
  try {
    const res  = await fetch('/api/admin/posts');
    const data = await res.json();
    const post = (data.posts || []).find(p => p.id === id);
    if (!post) return;

    document.getElementById('post-title').value    = post.title    || '';
    document.getElementById('post-excerpt').value  = post.excerpt  || '';
    document.getElementById('post-category').value = post.category || '';
    document.getElementById('post-date').value     = post.date     || '';
    featured = post.featured || false;
    updateFeaturedBtn();

    if (post.image) {
      const prev = document.getElementById('cover-preview');
      prev.src = post.image.startsWith('http') ? post.image : '/' + post.image;
      prev.style.display = 'block';
    }

    if (post.blocks && post.blocks.length) {
      post.blocks.forEach(b => addBlock(b.type, b));
    } else {
      if (post.content) addBlock('text', { text: post.content });
    }
  } catch (e) {
    toast('Could not load post.', 'error');
  }
}

// ── Block management ────────────────────────────────────────────────────────────
function addBlock(type, data) {
  const id  = 'blk-' + (blockIdx++);
  const obj = { id, type, ...(data || {}) };
  blocks.push(obj);
  renderBlock(obj);
}

function renderBlock(b) {
  const container = document.getElementById('blocks-container');
  const div = document.createElement('div');
  div.className = 'block-card block-' + b.type;
  div.id        = 'card-' + b.id;
  div.innerHTML = blockHTML(b);
  container.appendChild(div);
  attachBlockEvents(b.id, b.type, div);
}

function blockHTML(b) {
  const icons  = { text: 'bi-text-left', image: 'bi-image', video: 'bi-play-circle' };
  const labels = { text: 'Text Block (Markdown)', image: 'Image / Photo', video: 'Video' };
  return `
    <div class="block-header">
      <span class="block-type-label">
        <i class="bi ${icons[b.type]}"></i> ${labels[b.type]}
      </span>
      <div class="block-controls">
        <button class="block-btn" title="Move up"   onclick="moveBlock('${b.id}',-1)"><i class="bi bi-arrow-up"></i></button>
        <button class="block-btn" title="Move down" onclick="moveBlock('${b.id}',1)"><i class="bi bi-arrow-down"></i></button>
        <button class="block-btn del" title="Delete" onclick="deleteBlock('${b.id}')"><i class="bi bi-trash"></i></button>
      </div>
    </div>
    <div class="block-body">
      ${b.type === 'text'  ? textBlockBody(b)  : ''}
      ${b.type === 'image' ? imageBlockBody(b) : ''}
      ${b.type === 'video' ? videoBlockBody(b) : ''}
    </div>`;
}

// ── Text block with markdown toolbar + live preview ────────────────────────────
function textBlockBody(b) {
  const text = esc(b.text || '');
  return `
    <div class="md-toolbar">
      <button class="md-btn" title="Heading 1"     onclick="mdWrap('${b.id}','# ','',true)">H1</button>
      <button class="md-btn" title="Heading 2"     onclick="mdWrap('${b.id}','## ','',true)">H2</button>
      <button class="md-btn" title="Heading 3"     onclick="mdWrap('${b.id}','### ','',true)">H3</button>
      <span class="md-sep">|</span>
      <button class="md-btn" title="Bold"          onclick="mdWrap('${b.id}','**','**')"><b>B</b></button>
      <button class="md-btn" title="Italic"        onclick="mdWrap('${b.id}','*','*')"><i>I</i></button>
      <button class="md-btn" title="Strikethrough" onclick="mdWrap('${b.id}','~~','~~')"><s>S</s></button>
      <span class="md-sep">|</span>
      <button class="md-btn" title="Bullet list"   onclick="mdWrap('${b.id}','- ','',true)">• List</button>
      <button class="md-btn" title="Numbered list" onclick="mdWrap('${b.id}','1. ','',true)">1. List</button>
      <button class="md-btn" title="Blockquote"    onclick="mdWrap('${b.id}','> ','',true)">❝ Quote</button>
      <span class="md-sep">|</span>
      <button class="md-btn" title="Inline code"   onclick="mdWrap('${b.id}','\`','\`')">Code</button>
      <button class="md-btn" title="Divider"       onclick="mdInsert('${b.id}','\\n---\\n')">─ HR</button>
      <button class="md-btn" title="Link"          onclick="mdLink('${b.id}')">🔗 Link</button>
      <div class="md-preview-toggle">
        <button id="tab-edit-${b.id}"    class="active" onclick="mdTab('${b.id}','edit')">Edit</button>
        <button id="tab-preview-${b.id}" onclick="mdTab('${b.id}','preview')">Preview</button>
      </div>
    </div>
    <textarea class="block-textarea" id="text-${b.id}"
      placeholder="Write your content here using Markdown…&#10;&#10;# Heading&#10;**bold** *italic*&#10;- bullet list&#10;> blockquote"
    >${text}</textarea>
    <div class="md-preview-box" id="preview-${b.id}"></div>
    <div class="md-hint">
      <span>Markdown:</span>
      <code># H1</code><code>**bold**</code><code>*italic*</code>
      <code>- list</code><code>> quote</code><code>\`code\`</code>
      <code>---</code>
    </div>`;
}

// ── Markdown toolbar actions ───────────────────────────────────────────────────

// Wrap selected text (or insert at cursor) with prefix/suffix
// lineMode=true: applies prefix to the start of the line (for headings, lists)
function mdWrap(id, prefix, suffix, lineMode) {
  const ta    = document.getElementById('text-' + id);
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const val   = ta.value;
  let selected = val.substring(start, end);

  let newText, cursorStart, cursorEnd;

  if (lineMode) {
    // Find start of line
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const before    = val.substring(0, lineStart);
    const line      = val.substring(lineStart, end || start);
    const after     = val.substring(end || start);
    newText = before + prefix + line + after;
    ta.value = newText;
    ta.selectionStart = lineStart + prefix.length;
    ta.selectionEnd   = lineStart + prefix.length + line.length;
  } else {
    if (!selected) selected = 'text';
    const before = val.substring(0, start);
    const after  = val.substring(end);
    newText = before + prefix + selected + suffix + after;
    ta.value = newText;
    ta.selectionStart = start + prefix.length;
    ta.selectionEnd   = start + prefix.length + selected.length;
  }

  ta.focus();
}

function mdInsert(id, snippet) {
  const ta    = document.getElementById('text-' + id);
  const start = ta.selectionStart;
  const val   = ta.value;
  ta.value = val.substring(0, start) + snippet + val.substring(start);
  ta.selectionStart = ta.selectionEnd = start + snippet.length;
  ta.focus();
}

function mdLink(id) {
  const ta    = document.getElementById('text-' + id);
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const val   = ta.value;
  const selected = val.substring(start, end) || 'link text';
  const url      = prompt('Enter URL:', 'https://');
  if (!url) return;
  const snippet = '[' + selected + '](' + url + ')';
  ta.value = val.substring(0, start) + snippet + val.substring(end);
  ta.selectionStart = start;
  ta.selectionEnd   = start + snippet.length;
  ta.focus();
}

// Toggle between Edit and Preview tabs
function mdTab(id, tab) {
  const ta      = document.getElementById('text-' + id);
  const preview = document.getElementById('preview-' + id);
  const tabEdit = document.getElementById('tab-edit-' + id);
  const tabPrev = document.getElementById('tab-preview-' + id);

  if (tab === 'preview') {
    preview.innerHTML = marked.parse(ta.value || '*Nothing to preview yet.*');
    preview.classList.add('show');
    ta.style.display = 'none';
    tabEdit.classList.remove('active');
    tabPrev.classList.add('active');
  } else {
    preview.classList.remove('show');
    ta.style.display = 'block';
    ta.focus();
    tabEdit.classList.add('active');
    tabPrev.classList.remove('active');
  }
}

function imageBlockBody(b) {
  const hasImg = b.image && b.image.trim();
  return `
    <div class="img-upload-area" id="drop-${b.id}">
      <input type="file" id="imgfile-${b.id}" accept="image/*">
      <div class="upload-icon"><i class="bi bi-cloud-arrow-up"></i></div>
      <p>Click to upload an image</p>
    </div>
    <img class="img-preview" id="imgprev-${b.id}"
      src="${hasImg ? (b.image.startsWith('http') ? b.image : '/' + b.image) : ''}"
      style="${hasImg ? 'display:block' : 'display:none'}" alt="">
    <input class="img-caption-input" id="caption-${b.id}"
      placeholder="Optional caption…" value="${esc(b.caption || '')}">
    <input type="hidden" id="imgpath-${b.id}" value="${esc(b.image || '')}">`;
}

function videoBlockBody(b) {
  const isYT = b.videoType === 'youtube';
  const isUp = b.videoType === 'upload';
  return `
    <div class="video-type-tabs">
      <button class="vtab ${isYT || (!isUp && !isYT) ? 'active' : ''}"
        onclick="setVideoTab('${b.id}','youtube',this)">
        <i class="bi bi-youtube"></i> YouTube URL
      </button>
      <button class="vtab ${isUp ? 'active' : ''}"
        onclick="setVideoTab('${b.id}','upload',this)">
        <i class="bi bi-upload"></i> Upload Video
      </button>
    </div>
    <div class="video-youtube-input ${isUp ? '' : 'show'}" id="yt-${b.id}">
      <input class="video-url-field" id="yturl-${b.id}"
        placeholder="https://www.youtube.com/watch?v=..."
        value="${esc(b.videoUrl || '')}">
    </div>
    <div class="video-file-input ${isUp ? 'show' : ''}" id="vfile-${b.id}">
      <div class="video-file-area">
        <input type="file" id="videofile-${b.id}" accept="video/*">
        <i class="bi bi-camera-video" style="font-size:2rem;color:var(--muted)"></i>
        <p style="font-size:0.85rem;color:var(--muted);margin-top:6px">Click to upload video file</p>
      </div>
      <div class="video-file-name" id="vfilename-${b.id}">
        ${b.videoSrc ? '✓ ' + b.videoSrc.split('/').pop() : ''}
      </div>
      <input type="hidden" id="vsrc-${b.id}" value="${esc(b.videoSrc || '')}">
    </div>`;
}

function attachBlockEvents(id, type, div) {
  if (type === 'image') {
    const fileInput = div.querySelector('#imgfile-' + id);
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        if (!this.files[0]) return;
        const reader = new FileReader();
        reader.onload = e => {
          const prev = document.getElementById('imgprev-' + id);
          prev.src = e.target.result;
          prev.style.display = 'block';
        };
        reader.readAsDataURL(this.files[0]);
      });
    }
  }
  if (type === 'video') {
    const vf = div.querySelector('#videofile-' + id);
    if (vf) {
      vf.addEventListener('change', function () {
        if (this.files[0]) {
          document.getElementById('vfilename-' + id).textContent = '✓ ' + this.files[0].name;
        }
      });
    }
  }
}

function setVideoTab(id, tab, btn) {
  btn.closest('.block-body').querySelectorAll('.vtab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('yt-' + id).classList.toggle('show', tab === 'youtube');
  document.getElementById('vfile-' + id).classList.toggle('show', tab === 'upload');
}

function moveBlock(id, dir) {
  const idx    = blocks.findIndex(b => b.id === id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= blocks.length) return;
  [blocks[idx], blocks[newIdx]] = [blocks[newIdx], blocks[idx]];
  rebuildDOM();
}

function deleteBlock(id) {
  if (!confirm('Remove this block?')) return;
  blocks = blocks.filter(b => b.id !== id);
  const card = document.getElementById('card-' + id);
  if (card) card.remove();
}

function rebuildDOM() {
  const container = document.getElementById('blocks-container');
  container.innerHTML = '';
  blocks.forEach(b => renderBlock(b));
}

// ── Cover image preview ────────────────────────────────────────────────────────
function previewCoverFile(input) {
  if (!input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    const prev = document.getElementById('cover-preview');
    prev.src = e.target.result;
    prev.style.display = 'block';
  };
  reader.readAsDataURL(input.files[0]);
}

// ── Featured toggle ────────────────────────────────────────────────────────────
function toggleFeatured() { featured = !featured; updateFeaturedBtn(); }
function updateFeaturedBtn() {
  const btn = document.getElementById('featured-btn');
  btn.classList.toggle('on', featured);
  btn.innerHTML = featured
    ? '<i class="bi bi-star-fill"></i> Featured ✓'
    : '<i class="bi bi-star"></i> Featured';
}

// ── Collect blocks from DOM ────────────────────────────────────────────────────
function collectBlocks() {
  return blocks.map((b, i) => {
    if (b.type === 'text') {
      return {
        type: 'text',
        text: (document.getElementById('text-' + b.id) || {}).value || b.text || ''
      };
    }
    if (b.type === 'image') {
      return {
        type:    'image',
        image:   (document.getElementById('imgpath-' + b.id) || {}).value || b.image || '',
        caption: (document.getElementById('caption-' + b.id) || {}).value || ''
      };
    }
    if (b.type === 'video') {
      const ytShow = document.getElementById('yt-' + b.id);
      const tab    = ytShow && ytShow.classList.contains('show') ? 'youtube' : 'upload';
      return {
        type:      'video',
        videoType: tab,
        videoUrl:  tab === 'youtube' ? ((document.getElementById('yturl-' + b.id) || {}).value || '') : '',
        videoSrc:  tab === 'upload'  ? ((document.getElementById('vsrc-' + b.id)  || {}).value || '') : ''
      };
    }
    return b;
  });
}

// ── Save post ──────────────────────────────────────────────────────────────────
async function savePost() {
  const title    = document.getElementById('post-title').value.trim();
  const excerpt  = document.getElementById('post-excerpt').value.trim();
  const category = document.getElementById('post-category').value.trim();
  const date     = document.getElementById('post-date').value.trim();

  if (!title || !excerpt || !category) {
    toast('Title, excerpt and category are required.', 'error'); return;
  }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-inline"></span> Saving…';

  try {
    const fd = new FormData();
    fd.append('title',    title);
    fd.append('excerpt',  excerpt);
    fd.append('category', category);
    fd.append('date',     date);
    fd.append('featured', featured);

    const coverFile = document.getElementById('cover-file').files[0];
    if (coverFile) fd.append('image', coverFile);

    const collectedBlocks = collectBlocks();
    let imgIdx = 0, vidIdx = 0;

    collectedBlocks.forEach((b, i) => {
      if (b.type === 'image') {
        const fileInput = document.getElementById('imgfile-' + blocks[i].id);
        if (fileInput && fileInput.files[0]) {
          fd.append('block_image_' + imgIdx, fileInput.files[0]);
          b._fileKey = 'block_image_' + imgIdx;
          imgIdx++;
        }
      }
      if (b.type === 'video' && b.videoType === 'upload') {
        const fileInput = document.getElementById('videofile-' + blocks[i].id);
        if (fileInput && fileInput.files[0]) {
          fd.append('block_video_' + vidIdx, fileInput.files[0]);
          b._fileKey = 'block_video_' + vidIdx;
          vidIdx++;
        }
      }
    });

    fd.append('blocks', JSON.stringify(collectedBlocks));

    // Legacy content fallback — first text block value
    const firstText = collectedBlocks.find(b => b.type === 'text');
    fd.append('content', firstText ? firstText.text : '');

    const url    = editingId ? '/api/admin/posts/' + editingId : '/api/admin/posts';
    const method = editingId ? 'PUT' : 'POST';
    const res    = await fetch(url, { method, body: fd });
    const data   = await res.json();

    if (data.success) {
      toast(editingId ? 'Post updated!' : 'Post published!', 'success');
      document.getElementById('save-status').textContent = 'Saved ✓';
      if (!editingId && data.postId) {
        editingId = data.postId;
        history.replaceState(null, '', '/admin/posts/edit/' + editingId);
        document.getElementById('page-title').innerHTML = '<i class="bi bi-pencil"></i> Edit Post';
        btn.innerHTML = '<i class="bi bi-cloud-upload"></i> Update Post';
      }
    } else {
      toast(data.message || 'Failed to save.', 'error');
    }
  } catch (e) {
    toast('Network error: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    if (btn.innerHTML.includes('spinner')) {
      btn.innerHTML = editingId
        ? '<i class="bi bi-cloud-upload"></i> Update Post'
        : '<i class="bi bi-cloud-upload"></i> Publish Post';
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + (type || 'success');
  setTimeout(() => { el.className = ''; }, 3500);
}
</script>
</body>
</html>

admin/css
/* Admin Panel CSS */
:root {
  --sidebar: #1a3c5e;
  --sidebar-hover: #2d5f8a;
  --accent: #c8971f;
  --admin-bg: #f4f6f9;
  --white: #ffffff;
  --border: #e0e6ef;
  --text: #2d3748;
  --muted: #718096;
  --success: #28a745;
  --danger: #dc3545;
  --warning: #f0a500;
  --sidebar-width: 240px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', 'Segoe UI', sans-serif; background: var(--admin-bg); color: var(--text); display: flex; min-height: 100vh; }

/* Sidebar */
.sidebar { width: var(--sidebar-width); background: var(--sidebar); color: white; display: flex; flex-direction: column; position: fixed; top: 0; left: 0; bottom: 0; z-index: 100; }
.sidebar-brand { padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
.sidebar-brand h2 { font-size: 0.95rem; color: white; line-height: 1.3; }
.sidebar-brand p { font-size: 0.7rem; opacity: 0.55; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.sidebar-nav { flex: 1; padding: 12px 0; overflow-y: auto; }
.nav-section { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 1.5px; color: rgba(255,255,255,0.35); padding: 12px 18px 6px; }
.nav-link { display: flex; align-items: center; gap: 10px; padding: 10px 18px; color: rgba(255,255,255,0.72); text-decoration: none; font-size: 0.875rem; transition: all 0.2s; border-left: 3px solid transparent; }
.nav-link i { font-size: 1rem; width: 20px; flex-shrink: 0; }
.nav-link:hover, .nav-link.active { color: white; background: rgba(255,255,255,0.08); border-left-color: var(--accent); }
.sidebar-footer { padding: 14px 18px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; color: rgba(255,255,255,0.5); }
.sidebar-footer a { color: rgba(255,255,255,0.7); text-decoration: none; }
.sidebar-footer a:hover { color: white; }

/* Main */
.main-content { margin-left: var(--sidebar-width); flex: 1; display: flex; flex-direction: column; min-height: 100vh; }
.topbar { background: var(--white); border-bottom: 1px solid var(--border); padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 50; }
.topbar h1 { font-size: 1.1rem; font-weight: 600; }
.topbar-actions { display: flex; align-items: center; gap: 12px; }
.admin-avatar { width: 36px; height: 36px; background: var(--sidebar); border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; }
.page-body { padding: 24px 28px; flex: 1; }

/* Stats */
.stat-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card { background: var(--white); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.stat-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; margin-bottom: 12px; }
.stat-number { font-size: 1.9rem; font-weight: 700; line-height: 1; margin-bottom: 6px; }
.stat-label { font-size: 0.78rem; color: var(--muted); }

/* Cards */
.card { background: var(--white); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 20px; }
.card-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.card-header h3 { font-size: 0.95rem; font-weight: 600; }
.card-body { padding: 20px; }

/* Table */
.admin-table { width: 100%; border-collapse: collapse; }
.admin-table th { text-align: left; padding: 10px 14px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); border-bottom: 2px solid var(--border); background: #f8fafc; }
.admin-table td { padding: 12px 14px; border-bottom: 1px solid var(--border); font-size: 0.875rem; vertical-align: middle; }
.admin-table tr:hover td { background: #f8fafc; }
.admin-table tr:last-child td { border-bottom: none; }
.post-thumb { width: 52px; height: 40px; object-fit: cover; border-radius: 6px; background: var(--border); }

/* Badges */
.badge { padding: 4px 10px; border-radius: 20px; font-size: 0.7rem; font-weight: 600; display: inline-block; }
.badge-success { background: #d4edda; color: #155724; }
.badge-warning { background: #fff3cd; color: #856404; }
.badge-info { background: #d1ecf1; color: #0c5460; }
.badge-danger { background: #f8d7da; color: #721c24; }
.badge-secondary { background: #e2e8f0; color: #4a5568; }

/* Buttons */
.btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 0.875rem; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; transition: all 0.2s; }
.btn-primary { background: var(--sidebar); color: white; }
.btn-primary:hover { background: var(--sidebar-hover); }
.btn-success { background: var(--success); color: white; }
.btn-success:hover { background: #218838; }
.btn-danger { background: var(--danger); color: white; }
.btn-danger:hover { background: #c82333; }
.btn-warning { background: var(--warning); color: white; }
.btn-outline { background: transparent; color: var(--text); border: 1px solid var(--border); }
.btn-outline:hover { background: var(--admin-bg); }
.btn-sm { padding: 5px 10px; font-size: 0.78rem; }
.btn-icon { padding: 6px; border-radius: 6px; }

/* Forms */
.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 6px; }
.form-control { width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; font-family: inherit; outline: none; transition: border-color 0.2s; background: white; }
.form-control:focus { border-color: var(--sidebar); }
textarea.form-control { resize: vertical; min-height: 120px; }
.form-check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.form-check input { width: 16px; height: 16px; cursor: pointer; }

/* Alert */
.alert { padding: 12px 16px; border-radius: 8px; font-size: 0.875rem; margin-bottom: 16px; display: none; }
.alert.show { display: block; }
.alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
.alert-danger { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }

/* Image preview */
.img-preview { width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); display: none; margin-top: 10px; }

/* Toggle switch */
.toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; cursor: pointer; inset: 0; background: #ccc; border-radius: 22px; transition: 0.3s; }
.toggle-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.3s; }
input:checked + .toggle-slider { background: var(--sidebar); }
input:checked + .toggle-slider:before { transform: translateX(18px); }

/* Login */
.login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--sidebar) 0%, #2d5f8a 100%); }
.login-card { background: white; border-radius: 16px; padding: 40px; width: 100%; max-width: 400px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
.login-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
.login-logo h1 { font-size: 1.3rem; color: var(--sidebar); }
.login-card p { color: var(--muted); font-size: 0.88rem; margin-bottom: 28px; }

/* Empty state */
.empty-state { text-align: center; padding: 48px 20px; color: var(--muted); }
.empty-state i { font-size: 3rem; margin-bottom: 12px; display: block; }

/* Message card */
.message-card { background: var(--white); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 14px; }
.message-card.unread { border-left: 4px solid var(--accent); }
.message-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.message-from { font-weight: 600; font-size: 0.92rem; }
.message-meta { font-size: 0.78rem; color: var(--muted); }
.message-subject { font-weight: 500; margin-bottom: 8px; }
.message-body { font-size: 0.88rem; color: var(--muted); line-height: 1.6; }

/* Spinner */
.spinner { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; }
.spinner-dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--sidebar); }
@keyframes spin { to { transform: rotate(360deg); } }

/* Responsive */
@media (max-width: 768px) {
  .sidebar { transform: translateX(-100%); transition: transform 0.3s; }
  .sidebar.open { transform: translateX(0); }
  .main-content { margin-left: 0; }
  .stat-cards { grid-template-columns: repeat(2, 1fr); }
  .page-body { padding: 16px; }
}

// server/routes/posts.js
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const store   = require('../data/store');

// ─────────────────────────────────────────────────────────────────────────────
// CLOUDINARY SIGNED URL HELPER
// ─────────────────────────────────────────────────────────────────────────────
function signedCloudinaryUrl(publicId, resourceType = 'image', transformation = '') {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;

  const toSign    = (transformation ? transformation + '/' : '') + publicId;
  const rawHash   = crypto.createHash('sha1').update(toSign + apiSecret).digest('base64');
  const signature = rawHash.replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);
  const sigComponent  = `s--${signature}--`;
  const transformPart = transformation ? `/${transformation}` : '';
  return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${sigComponent}${transformPart}/${publicId}`;
}

function extractPublicId(url) {
  if (!url) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  return match[1].replace(/\.[^.]+$/, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let posts = await store.getAllPosts();
    const { category, search } = req.query;

    if (category && category !== 'all') {
      posts = posts.filter(p =>
        p.category && p.category.toLowerCase() === category.toLowerCase()
      );
    }
    if (search) {
      const q = search.toLowerCase();
      posts = posts.filter(p =>
        (p.title   && p.title.toLowerCase().includes(q))   ||
        (p.excerpt && p.excerpt.toLowerCase().includes(q)) ||
        (p.content && p.content.toLowerCase().includes(q))
      );
    }
    res.json({ success: true, posts });
  } catch (err) {
    console.error('GET /api/posts error:', err);
    res.status(500).json({ success: false, message: 'Failed to load posts.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/slider  — MUST be before /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/slider', async (req, res) => {
  try {
    const slides = await store.getSliderPosts();
    res.json({ success: true, slides });
  } catch (err) {
    console.error('GET /api/posts/slider error:', err);
    res.status(500).json({ success: false, message: 'Failed to load slider.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/site-settings  — MUST be before /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/site-settings', async (req, res) => {
  try {
    const settings = await store.getSettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/categories  — MUST be before /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const categories = await store.getCategories();
    res.json({ success: true, categories });
  } catch (err) {
    console.error('GET /api/posts/categories error:', err);
    res.status(500).json({ success: false, message: 'Failed to load categories.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const post = await store.getPostById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    res.json({ success: true, post });
  } catch (err) {
    console.error('GET /api/posts/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to load post.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/:id/og  — Open Graph data for social sharing
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/og', async (req, res) => {
  try {
    const post = await store.getPostById(req.params.id);
    if (!post) return res.status(404).json({ success: false });

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const postUrl = `${siteUrl}/post/${post.id}`;

    let ogImage = post.image || `${siteUrl}/favicon.png`;
    if (post.image && process.env.CLOUDINARY_CLOUD_NAME) {
      const publicId = extractPublicId(post.image);
      if (publicId) {
        const signed = signedCloudinaryUrl(publicId, 'image', 'c_fill,w_1200,h_630,q_auto,f_jpg');
        if (signed) ogImage = signed;
      }
    }

    res.json({
      success:     true,
      title:       post.title,
      description: post.excerpt,
      image:       ogImage,
      url:         postUrl,
      siteName:    'Hon. Leke Abejide',
      type:        'article',
      date:        post.date,
      category:    post.category,
    });
  } catch (err) {
    console.error('GET /api/posts/:id/og error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/:id/comments
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/comments', async (req, res) => {
  try {
    const comments = await store.getCommentsByPost(req.params.id);
    res.json({ success: true, comments });
  } catch (err) {
    console.error('GET /api/posts/:id/comments error:', err);
    res.status(500).json({ success: false, message: 'Failed to load comments.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/posts/:id/comments
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/comments', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message)
      return res.status(400).json({ success: false, message: 'All fields are required.' });

    const comment = await store.addComment(req.params.id, name, email, message);
    res.json({ success: true, comment, message: 'Comment posted successfully!' });
  } catch (err) {
    console.error('POST /api/posts/:id/comments error:', err);
    res.status(500).json({ success: false, message: 'Failed to post comment.' });
  }
});

module.exports = router;
// server/middleware/auth.js
const { adminUser } = require('../data/store');

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) {
    return next();
  }
  // API requests
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  res.redirect('/admin/login');
}

module.exports = { requireAdmin };

const { apiLimiter, contactLimiter } = require('./rateLimiter');
const { requireAdmin } = require('./auth');
module.exports = { apiLimiter, contactLimiter, requireAdmin };

// server/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many messages sent. Please try again in 15 minutes.' }
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: { success: false, message: 'Too many requests. Please slow down.' }
});

module.exports = { contactLimiter, apiLimiter };
// server/routes/contact.js
const express = require('express');
const router = express.Router();
const store = require('../data/store');

// POST /api/contact
router.post('/', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address.' });
  }

  store.addContactMessage(name, email, subject, message);

  // Optionally send email if SMTP configured
  if (process.env.SMTP_HOST) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      await transporter.sendMail({
        from: `"${name}" <${process.env.SMTP_USER}>`,
        replyTo: email,
        to: process.env.RECEIVING_EMAIL || 'ayanisolomon1@gmail.com',
        subject: `[Blog Contact] ${subject}`,
        html: `<h2>New Contact Message</h2><p><b>From:</b> ${name} &lt;${email}&gt;</p><p><b>Subject:</b> ${subject}</p><p><b>Message:</b><br>${message.replace(/\n/g, '<br>')}</p>`
      });
    } catch (err) {
      console.error('Email error:', err.message);
    }
  }

  res.json({ success: true, message: 'Your message has been received. Thank you!' });
});

// POST /api/subscribe
router.post('/subscribe', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Invalid email.' });

  const result = store.addSubscriber(email);
  if (result.exists) return res.json({ success: true, message: 'You are already subscribed!' });
  res.json({ success: true, message: 'Thank you for subscribing!' });
});

module.exports = router;

