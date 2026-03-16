// server/routes/admin.js
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const store   = require('../data/store');
const { requireAdmin } = require('../middleware/auth');

// ── Cloudinary setup ───────────────────────────────────────────────────────────
let uploadToCloud = null;

if (process.env.CLOUDINARY_CLOUD_NAME) {
  try {
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });

    uploadToCloud = async (filePath, resourceType = 'image') => {
      const result = await cloudinary.uploader.upload(filePath, {
        folder:        'hon-leke-blog',
        resource_type: resourceType,
        transformation: resourceType === 'image'
          ? [{ width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }]
          : undefined
      });
      try { fs.unlinkSync(filePath); } catch(e) {}
      return result.secure_url;
    };
    console.log('✅ Cloudinary configured — media stored in the cloud.');
  } catch(e) {
    console.warn('⚠️  Cloudinary package not found. Run: npm install cloudinary');
  }
} else {
  console.log('ℹ️  No Cloudinary config — media saved to local disk.');
}

// ── Multer ─────────────────────────────────────────────────────────────────────
const imageDir = path.join(__dirname, '..', '..', 'client', 'public', 'image');
const videoDir = path.join(__dirname, '..', '..', 'client', 'public', 'video');

[imageDir, videoDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // block video fields and legacy 'video' field go to videoDir
    if (file.fieldname === 'video' || file.fieldname.startsWith('block_video_')) {
      cb(null, videoDir);
    } else {
      cb(null, imageDir);
    }
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname).toLowerCase());
  }
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'video' || file.fieldname.startsWith('block_video_')) {
    cb(null, /mp4|webm|mov|avi|mkv/.test(path.extname(file.originalname).toLowerCase()));
  } else {
    cb(null, /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase()));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 }
}).fields([
  { name: 'images', maxCount: 10 },
  { name: 'image',  maxCount: 1  },
  { name: 'video',  maxCount: 1  },
  // per-block image uploads: block_image_0 … block_image_19
  ...Array.from({ length: 20 }, (_, i) => ({ name: 'block_image_' + i, maxCount: 1 })),
  // per-block video uploads: block_video_0 … block_video_9
  ...Array.from({ length: 10 }, (_, i) => ({ name: 'block_video_' + i, maxCount: 1 })),
]);

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload(req, res, (err) => { if (err) reject(err); else resolve(); });
  });
}

// ── resolveImages (cover image) ────────────────────────────────────────────────
async function resolveImages(req, existingImage, existingImages) {
  const files      = req.files || {};
  const imageFiles = files['images'] || files['image'] || [];
  const coverIdx   = parseInt(req.body.coverIndex) || 0;

  if (!imageFiles.length) {
    const imagePath = req.body.imagePath;
    if (imagePath !== undefined && imagePath !== '') {
      return { coverImage: imagePath, allImages: [imagePath] };
    }
    return {
      coverImage: existingImage  || '',
      allImages:  existingImages || (existingImage ? [existingImage] : [])
    };
  }

  const resolvedPaths = await Promise.all(
    imageFiles.map(async (file) => {
      if (uploadToCloud) {
        try { return await uploadToCloud(file.path, 'image'); }
        catch(e) { console.error('Cloudinary image upload failed:', e.message); return 'image/' + file.filename; }
      }
      return 'image/' + file.filename;
    })
  );

  const safeIdx    = Math.min(coverIdx, resolvedPaths.length - 1);
  const coverImage = resolvedPaths[safeIdx];
  return { coverImage, allImages: resolvedPaths };
}

// ── resolveVideo (legacy top-level video) ─────────────────────────────────────
async function resolveVideo(req, existingVideoSrc) {
  const files     = req.files || {};
  const videoFile = (files['video'] || [])[0];
  const videoType = req.body.videoType || 'none';
  const videoUrl  = req.body.videoUrl  || '';
  const hasVideo  = req.body.hasVideo === 'true' || req.body.hasVideo === true;

  if (!hasVideo) return { hasVideo: false, videoType: 'none', videoSrc: '', videoUrl: '' };

  if (videoType === 'youtube' && videoUrl) {
    return { hasVideo: true, videoType: 'youtube', videoSrc: '', videoUrl };
  }

  if (videoFile) {
    let src;
    if (uploadToCloud) {
      try { src = await uploadToCloud(videoFile.path, 'video'); }
      catch(e) { console.error('Cloudinary video upload failed:', e.message); src = 'video/' + videoFile.filename; }
    } else {
      src = 'video/' + videoFile.filename;
    }
    return { hasVideo: true, videoType: 'upload', videoSrc: src, videoUrl: '' };
  }

  if (existingVideoSrc) {
    return { hasVideo: true, videoType: req.body.videoType || 'upload', videoSrc: existingVideoSrc, videoUrl };
  }

  return { hasVideo: false, videoType: 'none', videoSrc: '', videoUrl: '' };
}

// ── resolveBlocks (inline media blocks) ───────────────────────────────────────
async function resolveBlocks(req, rawBlocks) {
  if (!rawBlocks || !rawBlocks.length) return [];
  const files = req.files || {};

  let imgIdx = 0;
  let vidIdx = 0;

  return Promise.all(rawBlocks.map(async (b) => {
    const block = Object.assign({}, b);
    delete block._fileKey;

    if (block.type === 'image') {
      const key  = 'block_image_' + imgIdx++;
      const file = (files[key] || [])[0];
      if (file) {
        if (uploadToCloud) {
          try { block.image = await uploadToCloud(file.path, 'image'); }
          catch(e) { block.image = 'image/' + file.filename; }
        } else {
          block.image = 'image/' + file.filename;
        }
      }
      // if no new file, keep whatever image path was sent from the form
      return block;
    }

    if (block.type === 'video' && block.videoType === 'upload') {
      const key  = 'block_video_' + vidIdx++;
      const file = (files[key] || [])[0];
      if (file) {
        if (uploadToCloud) {
          try { block.videoSrc = await uploadToCloud(file.path, 'video'); }
          catch(e) { block.videoSrc = 'video/' + file.filename; }
        } else {
          block.videoSrc = 'video/' + file.filename;
        }
      }
      return block;
    }

    // video type youtube — nothing to upload
    if (block.type === 'video' && block.videoType === 'youtube') {
      return block;
    }

    return block;
  }));
}

// ── Auth ───────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const admin = store.adminUser;
  if (username === admin.username && password === admin.password) {
    req.session.admin     = true;
    req.session.adminName = admin.name;
    return res.json({ success: true, message: 'Login successful', name: admin.name });
  }
  res.status(401).json({ success: false, message: 'Invalid credentials.' });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out.' });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ success: true, name: req.session.adminName || 'Admin' });
});

// ── Stats ──────────────────────────────────────────────────────────────────────
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, stats: await store.getStats() });
  } catch (err) {
    console.error('GET /admin/stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to load stats.' });
  }
});

// ── Posts ──────────────────────────────────────────────────────────────────────
router.get('/posts', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, posts: await store.getAllPosts() });
  } catch (err) {
    console.error('GET /admin/posts error:', err);
    res.status(500).json({ success: false, message: 'Failed to load posts.' });
  }
});

// CREATE POST
router.post('/posts', requireAdmin, async (req, res) => {
  try {
    await runUpload(req, res);

    const { title, excerpt, content, category, date, featured } = req.body;
    if (!title || !excerpt || !category)
      return res.status(400).json({ success: false, message: 'Title, excerpt and category are required.' });

    // Cover image
    const { coverImage, allImages } = await resolveImages(req, '', []);

    // Inline blocks
    let rawBlocks = [];
    try { rawBlocks = JSON.parse(req.body.blocks || '[]'); } catch(e) {}
    const resolvedBlocks = await resolveBlocks(req, rawBlocks);

    // Legacy video — derive from blocks if present, else from form fields
    const videoBlock = resolvedBlocks.find(b => b.type === 'video');
    const videoData  = videoBlock
      ? { hasVideo: true, videoType: videoBlock.videoType, videoSrc: videoBlock.videoSrc || '', videoUrl: videoBlock.videoUrl || '' }
      : await resolveVideo(req, '');

    const post = await store.createPost({
      title,
      excerpt,
      content: content || '',
      category,
      date,
      featured: featured === 'true' || featured === true,
      image:    coverImage,
      images:   allImages,
      blocks:   resolvedBlocks,
      ...videoData
    });

    res.json({ success: true, message: 'Post created successfully!', post, postId: post.id });
  } catch (err) {
    console.error('POST /admin/posts error:', err);
    res.status(500).json({ success: false, message: 'Server error creating post: ' + err.message });
  }
});

// UPDATE POST
router.put('/posts/:id', requireAdmin, async (req, res) => {
  try {
    await runUpload(req, res);

    const id       = req.params.id;
    const existing = await store.getPostById(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Post not found.' });

    const { title, excerpt, content, category, date, featured } = req.body;

    // Cover image
    const { coverImage, allImages } = await resolveImages(req, existing.image, existing.images);

    // Inline blocks
    let rawBlocks = [];
    try { rawBlocks = JSON.parse(req.body.blocks || '[]'); } catch(e) {}
    const resolvedBlocks = await resolveBlocks(req, rawBlocks);

    // Legacy video
    const videoBlock = resolvedBlocks.find(b => b.type === 'video');
    const videoData  = videoBlock
      ? { hasVideo: true, videoType: videoBlock.videoType, videoSrc: videoBlock.videoSrc || '', videoUrl: videoBlock.videoUrl || '' }
      : await resolveVideo(req, existing.videoSrc);

    const post = await store.updatePost(id, {
      title,
      excerpt,
      content: content || '',
      category,
      date,
      featured: featured === 'true' || featured === true,
      image:    coverImage,
      images:   allImages,
      blocks:   resolvedBlocks,
      ...videoData
    });

    res.json({ success: true, message: 'Post updated successfully!', post });
  } catch (err) {
    console.error('PUT /admin/posts/:id error:', err);
    res.status(500).json({ success: false, message: 'Server error updating post: ' + err.message });
  }
});

// DELETE POST
router.delete('/posts/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await store.deletePost(req.params.id);
    if (!ok) return res.status(404).json({ success: false, message: 'Post not found.' });
    res.json({ success: true, message: 'Post deleted.' });
  } catch (err) {
    console.error('DELETE /admin/posts/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete post.' });
  }
});

// TOGGLE FEATURED
router.patch('/posts/:id/featured', requireAdmin, async (req, res) => {
  try {
    const post = await store.toggleFeatured(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    res.json({ success: true, message: post.featured ? 'Added to slider.' : 'Removed from slider.', featured: post.featured });
  } catch (err) {
    console.error('PATCH /admin/posts/:id/featured error:', err);
    res.status(500).json({ success: false, message: 'Failed to toggle featured.' });
  }
});

// ── Comments ───────────────────────────────────────────────────────────────────
router.get('/comments', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, comments: await store.getAllComments() });
  } catch (err) {
    console.error('GET /admin/comments error:', err);
    res.status(500).json({ success: false, message: 'Failed to load comments.' });
  }
});

router.delete('/comments/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await store.deleteComment(req.params.id);
    if (!ok) return res.status(404).json({ success: false, message: 'Comment not found.' });
    res.json({ success: true, message: 'Comment deleted.' });
  } catch (err) {
    console.error('DELETE /admin/comments/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete comment.' });
  }
});

// REPLY to a comment
router.patch('/comments/:id/reply', requireAdmin, async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply || !reply.trim())
      return res.status(400).json({ success: false, message: 'Reply text is required.' });

    const dateStr = new Date().toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    const Comment = require('../models/Comment');
    const doc = await Comment.findByIdAndUpdate(
      req.params.id,
      { reply: reply.trim(), repliedAt: dateStr, repliedByAdmin: true },
      { new: true }
    ).lean();

    if (!doc)
      return res.status(404).json({ success: false, message: 'Comment not found.' });

    const plain = JSON.parse(JSON.stringify(doc));
    plain.id = doc._id.toString();

    res.json({ success: true, message: 'Reply saved.', comment: plain });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// REMOVE a reply
router.patch('/comments/:id/reply/delete', requireAdmin, async (req, res) => {
  try {
    const Comment = require('../models/Comment');
    const doc = await Comment.findByIdAndUpdate(
      req.params.id,
      { reply: '', repliedAt: '', repliedByAdmin: false },
      { new: true }
    ).lean();

    if (!doc)
      return res.status(404).json({ success: false, message: 'Comment not found.' });

    res.json({ success: true, message: 'Reply removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Messages ───────────────────────────────────────────────────────────────────
router.get('/messages', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, messages: await store.getAllMessages() });
  } catch (err) {
    console.error('GET /admin/messages error:', err);
    res.status(500).json({ success: false, message: 'Failed to load messages.' });
  }
});

router.patch('/messages/:id/read', requireAdmin, async (req, res) => {
  try {
    const msg = await store.markMessageRead(req.params.id);
    if (!msg) return res.status(404).json({ success: false, message: 'Message not found.' });
    res.json({ success: true, message: 'Marked as read.' });
  } catch (err) {
    console.error('PATCH /admin/messages/:id/read error:', err);
    res.status(500).json({ success: false, message: 'Failed to mark message as read.' });
  }
});

router.delete('/messages/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await store.deleteMessage(req.params.id);
    if (!ok) return res.status(404).json({ success: false, message: 'Message not found.' });
    res.json({ success: true, message: 'Message deleted.' });
  } catch (err) {
    console.error('DELETE /admin/messages/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete message.' });
  }
});

// ── Subscribers ────────────────────────────────────────────────────────────────
router.get('/subscribers', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, subscribers: await store.getAllSubscribers() });
  } catch (err) {
    console.error('GET /admin/subscribers error:', err);
    res.status(500).json({ success: false, message: 'Failed to load subscribers.' });
  }
});

router.delete('/subscribers/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await store.deleteSubscriber(req.params.id);
    if (!ok) return res.status(404).json({ success: false, message: 'Subscriber not found.' });
    res.json({ success: true, message: 'Subscriber removed.' });
  } catch (err) {
    console.error('DELETE /admin/subscribers/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove subscriber.' });
  }
});

// ── Settings ───────────────────────────────────────────────────────────────────
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, settings: await store.getSettings() });
  } catch (err) {
    console.error('GET /admin/settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to load settings.' });
  }
});

router.put('/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await store.updateSettings(req.body);
    res.json({ success: true, message: 'Settings updated.', settings });
  } catch (err) {
    console.error('PUT /admin/settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to update settings.' });
  }
});

// ── About Page ─────────────────────────────────────────────────────────────────
const aboutUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).fields([
  { name: 'lekeImage',   maxCount: 1 },
  { name: 'spouseImage', maxCount: 1 },
  ...Array.from({ length: 20 }, (_, i) => ({ name: 'teamImage_' + i, maxCount: 1 }))
]);

function runAboutUpload(req, res) {
  return new Promise((resolve, reject) => {
    aboutUpload(req, res, err => err ? reject(err) : resolve());
  });
}

router.post('/about', requireAdmin, async (req, res) => {
  try {
    await runAboutUpload(req, res);
    const files     = req.files || {};
    const aboutData = JSON.parse(req.body.aboutData || '{}');

    if (files['lekeImage'] && files['lekeImage'][0]) {
      const f = files['lekeImage'][0];
      aboutData.lekeImage = uploadToCloud
        ? await uploadToCloud(f.path, 'image').catch(() => 'image/' + f.filename)
        : 'image/' + f.filename;
    }

    if (files['spouseImage'] && files['spouseImage'][0]) {
      const f = files['spouseImage'][0];
      aboutData.spouseImage = uploadToCloud
        ? await uploadToCloud(f.path, 'image').catch(() => 'image/' + f.filename)
        : 'image/' + f.filename;
    }

    if (aboutData.team) {
      for (let i = 0; i < aboutData.team.length; i++) {
        const key = 'teamImage_' + i;
        if (files[key] && files[key][0]) {
          const f = files[key][0];
          aboutData.team[i].image = uploadToCloud
            ? await uploadToCloud(f.path, 'image').catch(() => 'image/' + f.filename)
            : 'image/' + f.filename;
        }
      }
    }

    const current  = await store.getSettings();
    const settings = await store.updateSettings({ ...current, about: aboutData });
    res.json({ success: true, message: 'About page updated.', settings });
  } catch (err) {
    console.error('POST /admin/about error:', err);
    res.status(500).json({ success: false, message: 'Failed to save about page: ' + err.message });
  }
});

module.exports = router;

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- ── Open Graph / Social sharing meta tags ──────────────────────────────
       These are pre-filled with defaults here.
       When a real user visits, JS updates them via injectOGTags().
       When WhatsApp/Facebook/Twitter crawls the link, the server (posts.js
       /post/:id route) injects the real post values BEFORE sending HTML —
       so crawlers always see the correct title, image and description.
  ──────────────────────────────────────────────────────────────────────── -->
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

    /* Lazy img placeholder shimmer while loading */
    img.lazy-img { transition: opacity 0.3s ease; }
    img.lazy-img.skeleton { opacity: 0.5; }

    /* ── Image right-click protection ── */
    .post-single-img,
    .post-card-img {
      -webkit-user-select: none;
      user-select: none;
      pointer-events: none;
    }
    .img-protect-overlay {
      position: absolute;
      inset: 0;
      z-index: 10;
      cursor: default;
    }

    /* ── Video: full-width, normal playback inside post ── */
    .post-video-wrap {
      position: relative;
      width: 100%;
      border-radius: var(--radius-md, 12px);
      overflow: hidden;
      margin: 28px 0;
      background: #000;
    }
    .post-video-wrap video {
      width: 100%;
      display: block;
    }
  </style>
</head>
<body>

<div class="nav-overlay" id="nav-overlay"></div>

<!-- Block right-click save on images -->
<script>
  document.addEventListener("contextmenu", function(e) {
    if (e.target.tagName === "IMG") e.preventDefault();
  });
</script>

<header id="header">
  <div class="header-inner">
    <a href="/" class="logo">
      <img src="/Logo.png" alt="Hon. Leke Abejide"
           style="height:48px;width:auto;object-fit:contain;display:block;">
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

        <!-- ── Main post area ── -->
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
        </div><!-- /.post-main -->

        <!-- ── Sidebar ── -->
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

<!-- Cookie Banner -->
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

<script src="/js/app.js"></script>
<script>
(async function () {

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

  /* ── Update OG tags in DOM after post loads (for real users / browser tab) ──
     WhatsApp/Facebook/Twitter see the server-injected values (see posts.js).
     This just keeps the browser tab title and meta in sync.                   */
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
    } catch(e) {
      console.warn('OG tag update failed:', e.message);
    }
  }

  /* ── Load post ── */
  async function loadPost() {
    const skeleton = document.getElementById('post-skeleton');
    const el       = document.getElementById('post-content');
    try {
      const data = await API.get('/api/posts/' + postId);
      if (!data.success || !data.post) throw new Error('Not found');
      const p = data.post;
      document.title = p.title + ' — Hon. Leke Abejide';

      function renderTextBlock(text) {
        return text.split(/\n\n+/)
          .map(s => s.trim()).filter(Boolean)
          .map(para => '<p style="margin-bottom:1.4em">' + para.replace(/\n/g, '<br>') + '</p>')
          .join('');
      }

      /* Image block with right-click protection overlay */
      function renderImageBlock(b) {
        if (!b.image) return '';
        return (
          '<figure style="margin:28px 0">' +
            '<div class="post-single-img-wrap" style="position:relative">' +
              '<div class="post-single-img-blur" data-bg-src="' + mediaUrl(b.image) + '"></div>' +
              lazyImg(mediaUrl(b.image), 'post-single-img', b.caption || p.title, "this.parentElement.style.display='none'") +
              '<div class="img-protect-overlay" oncontextmenu="return false"></div>' +
            '</div>' +
            (b.caption
              ? '<figcaption style="text-align:center;font-size:0.82rem;color:var(--muted);margin-top:8px;font-style:italic">'
                + escHtml(b.caption) + '</figcaption>'
              : '') +
          '</figure>'
        );
      }

      /* Video block — full playback, no time limit */
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
          /* Full video, standard browser controls, no restrictions */
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

      let bodyHtml = '';

      if (p.blocks && p.blocks.length) {
        bodyHtml = p.blocks.map(b => {
          if (b.type === 'text')  return '<div class="post-single-content">' + renderTextBlock(b.text || '') + '</div>';
          if (b.type === 'image') return renderImageBlock(b);
          if (b.type === 'video') return renderVideoBlock(b);
          return '';
        }).join('');
      } else {
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
        '<span class="post-cat-badge">' + p.category + '</span>' +
        '<h1>' + p.title + '</h1>' +
        '<div class="post-meta-row" style="margin-bottom:28px">' +
        '<span><i class="bi bi-calendar3"></i> ' + p.date + '</span>' +
        '<span><i class="bi bi-person"></i> ' + siteOwnerName + '</span>' +
        '</div>' +
        bodyHtml +
        '<div class="share-row"><strong>Share:</strong><div class="social-links">' +
        '<a href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(window.location.href) + '" target="_blank" class="social-link"><i class="bi bi-facebook"></i></a>' +
        '<a href="https://twitter.com/intent/tweet?url=' + encodeURIComponent(window.location.href) + '&text=' + encodeURIComponent(p.title) + '" target="_blank" class="social-link"><i class="bi bi-twitter-x"></i></a>' +
        '<a href="https://wa.me/?text=' + encodeURIComponent(p.title + ' ' + window.location.href) + '" target="_blank" class="social-link" style="color:#25d366"><i class="bi bi-whatsapp"></i></a>' +
        '</div></div></div>';

      /* Update OG tags for browser tab (crawlers already got server-injected values) */
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
                    '<i class="bi bi-reply-fill"></i> Reply from ' + siteOwnerName +
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
      if (!posts.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:0.85rem">No other posts.</p>';
        return;
      }
      el.innerHTML = posts.map(p =>
        '<div class="recent-post-item" onclick="window.location.href=\'/post/' + p.id + '\'" style="cursor:pointer">' +
        (p.image
          ? '<img class="recent-post-thumb lazy-img skeleton" data-src="' + mediaUrl(p.image) + '" ' +
            'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" ' +
            'alt="' + p.title + '" loading="lazy" onerror="this.style.display=\'none\'">'
          : '<div class="recent-post-thumb recent-post-thumb-placeholder"><i class="bi bi-newspaper"></i></div>') +
        '<div class="recent-post-info"><h6>' + p.title.substring(0, 55) + (p.title.length > 55 ? '…' : '') + '</h6><span>' + p.date + '</span></div>' +
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
        '<a href="/?category=' + encodeURIComponent(cat.toLowerCase()) + '" class="sidebar-cat-link">' + cat + '</a>'
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

    /* Text block */
    .block-textarea{
      width:100%;min-height:120px;padding:10px 14px;
      border:1px solid var(--border);border-radius:8px;
      font-size:0.95rem;line-height:1.75;font-family:inherit;
      resize:vertical;outline:none;transition:border-color .2s;
    }
    .block-textarea:focus{border-color:var(--primary);}

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

    <!-- ── Cover image (thumbnail shown on blog grid) ── -->
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
        — add text and media blocks in any order
      </span>
    </div>

    <div id="blocks-container">
      <!-- blocks injected here -->
    </div>

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

<script>
// ── State ──────────────────────────────────────────────────────────────────────
let blocks    = [];       // array of block objects
let featured  = false;
let editingId = null;     // post ID if editing
let blockIdx  = 0;        // unique key for each block

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
    // Start with one empty text block
    addBlock('text');
  }

  // Cover image preview
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

    // Show existing cover image
    if (post.image) {
      const prev = document.getElementById('cover-preview');
      prev.src = post.image.startsWith('http') ? post.image : '/' + post.image;
      prev.style.display = 'block';
    }

    // Load blocks — if post has blocks use them, else convert legacy content
    if (post.blocks && post.blocks.length) {
      post.blocks.forEach(b => addBlock(b.type, b));
    } else {
      // Legacy post: convert to a single text block + top image
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
  div.className  = 'block-card block-' + b.type;
  div.id         = 'card-' + b.id;
  div.innerHTML  = blockHTML(b);
  container.appendChild(div);
  attachBlockEvents(b.id, b.type, div);
}

function blockHTML(b) {
  const icons  = { text: 'bi-text-left', image: 'bi-image', video: 'bi-play-circle' };
  const labels = { text: 'Text Block', image: 'Image / Photo', video: 'Video' };
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

function textBlockBody(b) {
  return `<textarea class="block-textarea" id="text-${b.id}"
    placeholder="Write your paragraph(s) here…">${esc(b.text || '')}</textarea>`;
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
  const isYT   = b.videoType === 'youtube';
  const isUp   = b.videoType === 'upload';
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
          prev.src          = e.target.result;
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
  const idx = blocks.findIndex(b => b.id === id);
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
function toggleFeatured() {
  featured = !featured;
  updateFeaturedBtn();
}
function updateFeaturedBtn() {
  const btn = document.getElementById('featured-btn');
  btn.classList.toggle('on', featured);
  btn.innerHTML = featured
    ? '<i class="bi bi-star-fill"></i> Featured ✓'
    : '<i class="bi bi-star"></i> Featured';
}

// ── Collect blocks from DOM ────────────────────────────────────────────────────
function collectBlocks() {
  return blocks.map(b => {
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
        // actual file upload handled separately in FormData below
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

    // Cover image file
    const coverFile = document.getElementById('cover-file').files[0];
    if (coverFile) fd.append('image', coverFile);

    // Collect block data — attach image/video files with indexed keys
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

    // Also build legacy content string (first text block) for backwards compat
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
        // Switch to edit mode after first save
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