// server/routes/posts.js
const express = require('express');
const router  = require('express').Router();
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
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

function escHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT — Wire this up in your main app.js/server.js BEFORE static files:
//
//   const postsRouter = require('./routes/posts');
//   app.use(postsRouter);                        // handles /post/:id SSR + all /api/posts/*
//   app.use(express.static(path.join(__dirname, 'public')));
//
// This ensures /post/:id is intercepted by Express (for OG tag injection)
// before the static file middleware can serve the bare post.html.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GET /post/:id  — serves post.html with OG tags already in <head>
//
// WhatsApp, Facebook, and Twitter crawlers DO NOT run JavaScript.
// They read only the raw HTML that the server sends. So OG tags MUST be
// present in the initial HTML response — not injected by JS after load.
// This route reads post.html from disk, injects the real post's OG values
// into the placeholder meta tags, then sends the result.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/post/:id', async (req, res, next) => {
  try {
    const post = await store.getPostById(req.params.id);

    // If post not found, fall through — post.html JS will show the 404 UI
    if (!post) return next();

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const postUrl = `${siteUrl}/post/${post.id}`;
    const siteName = 'Hon. Leke Abejide';
    const title    = post.title   || siteName;
    const desc     = post.excerpt || 'Read the latest from Hon. Leke Abejide';

    // Build OG image: signed Cloudinary 1200×630 crop, or fallback to raw image
    let ogImage = post.image || `${siteUrl}/favicon.png`;
    if (post.image && process.env.CLOUDINARY_CLOUD_NAME) {
      const publicId = extractPublicId(post.image);
      if (publicId) {
        const signed = signedCloudinaryUrl(publicId, 'image', 'c_fill,w_1200,h_630,q_auto,f_jpg');
        if (signed) ogImage = signed;
      }
    }

    // Read the static post.html from disk
    const htmlPath = path.join(__dirname, '../../public/post.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    // Inject real values into the placeholder meta tag content attributes
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
      // Inject canonical link before </head>
      .replace('</head>',
        `  <link rel="canonical" href="${escHtml(postUrl)}">\n</head>`);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('SSR error for /post/:id:', err);
    next(); // fall through to static file on error
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts — all posts with optional ?category= and ?search=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/posts', async (req, res) => {
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
// GET /api/posts/slider  — MUST be before /api/posts/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/posts/slider', async (req, res) => {
  try {
    const slides = await store.getSliderPosts();
    res.json({ success: true, slides });
  } catch (err) {
    console.error('GET /api/posts/slider error:', err);
    res.status(500).json({ success: false, message: 'Failed to load slider.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/site-settings — public settings (no auth)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/posts/site-settings', async (req, res) => {
  try {
    const settings = await store.getSettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/categories  — MUST be before /api/posts/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/posts/categories', async (req, res) => {
  try {
    const categories = await store.getCategories();
    res.json({ success: true, categories });
  } catch (err) {
    console.error('GET /api/posts/categories error:', err);
    res.status(500).json({ success: false, message: 'Failed to load categories.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/:id — single post
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/posts/:id', async (req, res) => {
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
// GET /api/posts/:id/og — OG data (used by JS to update page title after load)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/posts/:id/og', async (req, res) => {
  try {
    const post = await store.getPostById(req.params.id);
    if (!post) return res.status(404).json({ success: false });

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const postUrl = `${siteUrl}/post/${post.id}`;

    let ogImage = post.image || '';
    if (ogImage && process.env.CLOUDINARY_CLOUD_NAME) {
      const publicId = extractPublicId(ogImage);
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
// GET /api/posts/:id/media — signed Cloudinary URL on demand
// Query: ?type=image|video&publicId=<cloudinary_public_id>
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/posts/:id/media', async (req, res) => {
  try {
    const post = await store.getPostById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const { type = 'image', publicId } = req.query;
    if (!publicId) return res.status(400).json({ success: false, message: 'publicId is required.' });

    const transform    = type === 'video' ? 'q_auto,f_auto' : '';
    const resourceType = type === 'video' ? 'video' : 'image';

    const url = signedCloudinaryUrl(publicId, resourceType, transform);
    if (!url) return res.status(500).json({ success: false, message: 'Cloudinary not configured.' });

    res.json({ success: true, url });
  } catch (err) {
    console.error('GET /api/posts/:id/media error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/:id/comments
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/posts/:id/comments', async (req, res) => {
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
router.post('/api/posts/:id/comments', async (req, res) => {
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