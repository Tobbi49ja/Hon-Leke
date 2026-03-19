// server/routes/posts.js
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const store   = require('../data/store');

// ─────────────────────────────────────────────────────────────────────────────
// CLOUDINARY HELPER
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts
// Supports: ?category=  ?search=  ?tag=  ?dateFrom=  ?dateTo=  ?sort=popular
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let posts = await store.getAllPosts();
    const { category, search, tag, dateFrom, dateTo, sort } = req.query;

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

    if (tag) {
      const t = tag.toLowerCase();
      posts = posts.filter(p =>
        p.tags && p.tags.some(pt => pt.toLowerCase() === t)
      );
    }

    // ── Date filter ────────────────────────────────────────────────────────
    // Expects ISO date strings e.g. ?dateFrom=2024-01-01&dateTo=2024-12-31
    if (dateFrom) {
      const from = new Date(dateFrom);
      posts = posts.filter(p => p.createdAt && new Date(p.createdAt) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999); // include the full end day
      posts = posts.filter(p => p.createdAt && new Date(p.createdAt) <= to);
    }

    // ── Sort ───────────────────────────────────────────────────────────────
    if (sort === 'popular') {
      posts = posts.sort((a, b) => (b.views || 0) - (a.views || 0));
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
    res.status(500).json({ success: false, message: 'Failed to load categories.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/tags  — all unique tags across all posts
// ─────────────────────────────────────────────────────────────────────────────
router.get('/tags', async (req, res) => {
  try {
    const posts  = await store.getAllPosts();
    const tagSet = new Set();
    posts.forEach(p => {
      if (p.tags && Array.isArray(p.tags)) {
        p.tags.forEach(t => { if (t && t.trim()) tagSet.add(t.trim()); });
      }
    });
    res.json({ success: true, tags: [...tagSet].sort() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load tags.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/popular  — top posts by view count
// ─────────────────────────────────────────────────────────────────────────────
router.get('/popular', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const posts = await store.getPopularPosts(limit);
    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load popular posts.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/:id  — supports slug OR ObjectId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const post = await store.getPostBySlugOrId(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load post.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts/:id/og
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/og', async (req, res) => {
  try {
    const post = await store.getPostBySlugOrId(req.params.id);
    if (!post) return res.status(404).json({ success: false });

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const postSlug = post.slug || post.id;
    const postUrl  = `${siteUrl}/post/${postSlug}`;

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
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/posts/:id/view  — increment view counter
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/view', async (req, res) => {
  try {
    await store.incrementViews(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/posts/:id/like  — increment like/clap counter
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/like', async (req, res) => {
  try {
    const post = await store.incrementLikes(req.params.id);
    res.json({ success: true, likes: post ? post.likes : 0 });
  } catch (err) {
    res.json({ success: false });
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
    res.status(500).json({ success: false, message: 'Failed to post comment.' });
  }
});

module.exports = router;