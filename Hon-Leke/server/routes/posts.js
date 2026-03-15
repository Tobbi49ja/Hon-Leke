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