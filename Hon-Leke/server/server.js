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

// ── Cloudinary helpers ─────────────────────────────────────────────────────────
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

// ── Dynamic robots.txt ────────────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  const siteUrl = process.env.SITE_URL || `${req.protocol}://${req.headers.host}`;
  res.setHeader('Content-Type', 'text/plain');
  res.send(
`User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/admin/

Sitemap: ${siteUrl}/sitemap.xml`
  );
});

// ── Dynamic Sitemap ────────────────────────────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  const siteUrl = process.env.SITE_URL || `${req.protocol}://${req.headers.host}`;
  const staticPages = [
    { loc: '/',             changefreq: 'daily',   priority: '1.0' },
    { loc: '/about',        changefreq: 'monthly', priority: '0.8' },
    { loc: '/contact',      changefreq: 'monthly', priority: '0.7' },
    { loc: '/privacy',      changefreq: 'yearly',  priority: '0.3' },
    { loc: '/terms',        changefreq: 'yearly',  priority: '0.3' },
    { loc: '/cookie-policy',changefreq: 'yearly',  priority: '0.3' },
    { loc: '/disclaimer',   changefreq: 'yearly',  priority: '0.3' },
  ];

  let postUrls = '';
  try {
    const posts = await store.getAllPosts();
    postUrls = posts.map(p => {
      const slug    = p.slug || p._id;
      const lastmod = (p.updatedAt || p.createdAt || '').toString().slice(0, 10);
      return `  <url>\n    <loc>${siteUrl}/post/${slug}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>`;
    }).join('\n');
  } catch (e) {
    console.error('Sitemap post fetch error:', e);
  }

  const staticUrls = staticPages.map(p =>
    `  <url>\n    <loc>${siteUrl}${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${staticUrls}\n${postUrls}\n</urlset>`;
  res.setHeader('Content-Type', 'application/xml');
  res.send(xml);
});

// ── Client Pages ───────────────────────────────────────────────────────────────
const clientPages = path.join(__dirname, '..', 'client', 'pages');

app.get('/',        (req, res) => res.sendFile(path.join(clientPages, 'home',    'index.html')));
app.get('/about',   (req, res) => res.sendFile(path.join(clientPages, 'about',   'index.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(clientPages, 'contact', 'index.html')));

// ── Legal Pages ────────────────────────────────────────────────────────────────
app.get('/privacy',       (req, res) => res.sendFile(path.join(clientPages, 'privacy',       'index.html')));
app.get('/terms',         (req, res) => res.sendFile(path.join(clientPages, 'terms',         'index.html')));
app.get('/cookie-policy', (req, res) => res.sendFile(path.join(clientPages, 'cookie-policy', 'index.html')));
app.get('/disclaimer',    (req, res) => res.sendFile(path.join(clientPages, 'disclaimer',    'index.html')));

// ── /post/:slugOrId — inject OG tags + support slug-based URLs ────────────────
// Accepts BOTH /post/my-post-title-slug AND /post/64abc123objectid
// WhatsApp, Facebook, Twitter bots get server-injected OG tags.
// Regular browsers also benefit from instant title updates.
app.get('/post/:slugOrId', async (req, res) => {
  const htmlPath = path.join(clientPages, 'post', 'index.html');

  try {
    // getPostBySlugOrId tries slug first, falls back to ObjectId
    const post = await store.getPostBySlugOrId(req.params.slugOrId);

    // If post not found, serve the page — JS will show the 404 UI
    if (!post) return res.sendFile(htmlPath);

    const siteUrl  = process.env.SITE_URL || `${req.protocol}://${req.headers.host}`;
    // Canonical URL always uses slug if available
    const postSlug = post.slug || post.id;
    const postUrl  = `${siteUrl}/post/${postSlug}`;
    const siteName = 'Hon. Leke Abejide';
    const title    = post.title   || siteName;
    const desc     = post.excerpt || 'Read the latest from Hon. Leke Abejide';

    // Build OG image — try cover image, then first image block, then Logo fallback
    const firstBlockImage = (post.blocks || []).find(b => b.type === 'image' && b.image)?.image;
    const rawImage = post.image || firstBlockImage || `${siteUrl}/Logo.png`;
    let ogImage = rawImage;
    if ((post.image || firstBlockImage) && process.env.CLOUDINARY_CLOUD_NAME) {
      const publicId = extractPublicId(post.image || firstBlockImage);
      if (publicId) {
        const signed = signedCloudinaryUrl(publicId, 'image', 'c_fill,w_1200,h_630,q_auto,f_jpg');
        if (signed) ogImage = signed;
      }
    }

    // Schema.org JSON-LD for this specific article
    const schemaLD = JSON.stringify({
      "@context": "https://schema.org",
      "@type":    "NewsArticle",
      "headline": title,
      "description": desc,
      "image":    ogImage,
      "datePublished": post.createdAt || post.date,
      "author": {
        "@type": "Person",
        "name":  "Leke Joseph Abejide",
        "url":   siteUrl
      },
      "publisher": {
        "@type": "Organization",
        "name":  "Hon. Leke Abejide",
        "logo":  { "@type": "ImageObject", "url": `${siteUrl}/Logo.png` }
      },
      "mainEntityOfPage": { "@type": "WebPage", "@id": postUrl }
    });

    // Read the static HTML and inject meta values
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
      // Inject canonical + JSON-LD schema before </head>
      .replace('</head>',
        `  <link rel="canonical" href="${escHtml(postUrl)}">\n` +
        `  <script type="application/ld+json">${schemaLD}</script>\n` +
        `</head>`);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (err) {
    console.error('OG injection error for /post/:slugOrId:', err);
    res.sendFile(htmlPath);
  }
});

// ── Admin Pages ────────────────────────────────────────────────────────────────
const adminPages = path.join(__dirname, '..', 'admin', 'pages');

app.get('/admin',                       (req, res) => res.redirect('/admin/login'));
app.get('/admin/login',                 (req, res) => res.sendFile(path.join(adminPages, 'login.html')));
app.get('/admin/about',       requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'about.html')));
app.get('/admin/dashboard',   requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'dashboard.html')));
app.get('/admin/posts',       requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'posts.html')));
app.get('/admin/posts/new',   requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'post-form.html')));
app.get('/admin/posts/edit/:id', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'post-form.html')));
app.get('/admin/comments',    requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'comments.html')));
app.get('/admin/messages',    requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'messages.html')));
app.get('/admin/subscribers', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'subscribers.html')));
app.get('/admin/settings',    requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'settings.html')));
// ── NEW: Tags management page ──────────────────────────────────────────────────
app.get('/admin/tags',        requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'tags.html')));

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