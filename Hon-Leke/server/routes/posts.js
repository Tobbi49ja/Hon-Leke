// server/routes/posts.js
const express = require('express');
const router  = require('express').Router();
const crypto  = require('crypto');
const store   = require('../data/store');

// ─────────────────────────────────────────────────────────────────────────────
// CLOUDINARY SIGNED URL HELPER
// Generates a signed delivery URL so the URL cannot be tampered with.
// Requires env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// ─────────────────────────────────────────────────────────────────────────────
function signedCloudinaryUrl(publicId, resourceType = 'image', transformation = '') {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) return null;

  // Build string to sign: transformation (if any) + public_id
  const toSign    = (transformation ? transformation + '/' : '') + publicId;
  const rawHash   = crypto.createHash('sha1').update(toSign + apiSecret).digest('base64');
  const signature = rawHash.replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);

  const sigComponent  = `s--${signature}--`;
  const transformPart = transformation ? `/${transformation}` : '';

  return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${sigComponent}${transformPart}/${publicId}`;
}

// Watermark: semi-transparent text overlay on every image
const WATERMARK_TRANSFORM = 'l_text:Arial_18_bold:Hon.+Leke+Abejide,co_white,o_30,g_south_east,x_10,y_10/fl_attachment:false';

// Video: first 10 seconds only, auto quality/format
const VIDEO_PREVIEW_TRANSFORM = 'du_10,q_auto,f_auto';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: extract Cloudinary public_id from a stored URL
// e.g. https://res.cloudinary.com/cloud/image/upload/v123/folder/file.jpg
//   → folder/file
// ─────────────────────────────────────────────────────────────────────────────
function extractPublicId(url) {
  if (!url) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  return match[1].replace(/\.[^.]+$/, ''); // strip extension
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/posts — all posts with optional ?category= and ?search=
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
// GET /api/posts/slider — MUST be before /:id
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
// GET /api/posts/site-settings — public settings (no auth required)
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
// GET /api/posts/categories — MUST be before /:id
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
// GET /api/posts/:id — single post
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
// GET /api/posts/:id/og — Open Graph meta for a post
// Called by post.html to inject OG/Twitter tags dynamically.
// Returns a signed, resized Cloudinary image URL (1200×630) for the preview.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/og', async (req, res) => {
  try {
    const post = await store.getPostById(req.params.id);
    if (!post) return res.status(404).json({ success: false });

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const postUrl = `${siteUrl}/post/${post.id}`;

    // Build OG image: signed Cloudinary URL resized to 1200×630
    let ogImage = post.image || '';
    if (ogImage && process.env.CLOUDINARY_CLOUD_NAME) {
      const publicId = extractPublicId(ogImage);
      if (publicId) {
        // c_fill,w_1200,h_630 ensures correct crop for all platforms
        const ogTransform = 'c_fill,w_1200,h_630,q_auto,f_jpg';
        ogImage = signedCloudinaryUrl(publicId, 'image', ogTransform) || ogImage;
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
// GET /api/posts/:id/media — returns signed Cloudinary URL for a specific asset
// Query params: ?type=image|video&publicId=<cloudinary_public_id>
// Use this on the frontend whenever you need a protected media URL on demand.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/media', async (req, res) => {
  try {
    const post = await store.getPostById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const { type = 'image', publicId } = req.query;
    if (!publicId) return res.status(400).json({ success: false, message: 'publicId is required.' });

    let transform = '';
    let resourceType = type;

    if (type === 'image') {
      // Apply watermark to all served images
      transform = WATERMARK_TRANSFORM;
    } else if (type === 'video') {
      // Serve only first 10 seconds of video
      transform = VIDEO_PREVIEW_TRANSFORM;
      resourceType = 'video';
    }

    const url = signedCloudinaryUrl(publicId, resourceType, transform);
    if (!url) {
      return res.status(500).json({ success: false, message: 'Cloudinary not configured.' });
    }

    res.json({ success: true, url });
  } catch (err) {
    console.error('GET /api/posts/:id/media error:', err);
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