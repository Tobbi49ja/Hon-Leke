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