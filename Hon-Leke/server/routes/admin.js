// server/routes/admin.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const store = require('../data/store');
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
    uploadToCloud = async (filePath) => {
      const result = await cloudinary.uploader.upload(filePath, {
        folder: 'hon-leke-blog',
        transformation: [{ width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }]
      });
      try { fs.unlinkSync(filePath); } catch(e) {}
      return result.secure_url;
    };
    console.log('✅ Cloudinary configured — images stored in the cloud.');
  } catch(e) {
    console.warn('⚠️  Cloudinary package not found. Run: npm install cloudinary');
  }
} else {
  console.log('ℹ️  No Cloudinary config — images saved to local disk.');
}

// ── Multer ─────────────────────────────────────────────────────────────────────
const tempDir = path.join(__dirname, '..', '..', 'client', 'public', 'image');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, tempDir),
    filename:    (req, file, cb) => {
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase()));
  }
});

// ── Image resolver ─────────────────────────────────────────────────────────────
async function resolveImage(file, imagePath, fallback) {
  if (file) {
    if (uploadToCloud) {
      try { return await uploadToCloud(file.path); } catch(e) {
        console.error('Cloudinary upload failed:', e.message);
        return 'image/' + file.filename;
      }
    }
    return 'image/' + file.filename;
  }
  if (imagePath !== undefined && imagePath !== '') return imagePath;
  return fallback || '';
}

// ── Auth ───────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const admin = store.adminUser;
  if (username === admin.username && password === admin.password) {
    req.session.admin = true;
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
router.get('/stats', requireAdmin, (req, res) => {
  res.json({ success: true, stats: store.getStats() });
});

// ── Posts ──────────────────────────────────────────────────────────────────────
router.get('/posts', requireAdmin, (req, res) => {
  res.json({ success: true, posts: store.getAllPosts() });
});

router.post('/posts', requireAdmin, upload.single('image'), async (req, res) => {
  const { title, excerpt, content, category, date, featured, hasVideo, videoSrc, imagePath } = req.body;
  if (!title || !excerpt || !content || !category)
    return res.status(400).json({ success: false, message: 'Title, excerpt, content and category are required.' });
  const image = await resolveImage(req.file, imagePath, '');
  const post  = store.createPost({ title, excerpt, content, category, date, featured, hasVideo, videoSrc, image });
  res.json({ success: true, message: 'Post created successfully!', post });
});

router.put('/posts/:id', requireAdmin, upload.single('image'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, excerpt, content, category, date, featured, hasVideo, videoSrc, imagePath } = req.body;
  const existing = store.getPostById(id);
  if (!existing) return res.status(404).json({ success: false, message: 'Post not found.' });
  const image = await resolveImage(req.file, imagePath, existing.image);
  const post  = store.updatePost(id, { title, excerpt, content, category, date, featured, hasVideo, videoSrc, image });
  res.json({ success: true, message: 'Post updated successfully!', post });
});

router.delete('/posts/:id', requireAdmin, (req, res) => {
  const ok = store.deletePost(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ success: false, message: 'Post not found.' });
  res.json({ success: true, message: 'Post deleted.' });
});

router.patch('/posts/:id/featured', requireAdmin, (req, res) => {
  const post = store.toggleFeatured(parseInt(req.params.id));
  if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
  res.json({ success: true, message: post.featured ? 'Added to slider.' : 'Removed from slider.', featured: post.featured });
});

// ── Comments ───────────────────────────────────────────────────────────────────
router.get('/comments', requireAdmin, (req, res) => {
  res.json({ success: true, comments: store.getAllComments() });
});

router.delete('/comments/:id', requireAdmin, (req, res) => {
  const ok = store.deleteComment(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ success: false, message: 'Comment not found.' });
  res.json({ success: true, message: 'Comment deleted.' });
});

// ── Messages ───────────────────────────────────────────────────────────────────
router.get('/messages', requireAdmin, (req, res) => {
  res.json({ success: true, messages: store.getAllMessages() });
});

router.patch('/messages/:id/read', requireAdmin, (req, res) => {
  const msg = store.markMessageRead(parseInt(req.params.id));
  if (!msg) return res.status(404).json({ success: false, message: 'Message not found.' });
  res.json({ success: true, message: 'Marked as read.' });
});

router.delete('/messages/:id', requireAdmin, (req, res) => {
  const ok = store.deleteMessage(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ success: false, message: 'Message not found.' });
  res.json({ success: true, message: 'Message deleted.' });
});

// ── Subscribers ────────────────────────────────────────────────────────────────
router.get('/subscribers', requireAdmin, (req, res) => {
  res.json({ success: true, subscribers: store.getAllSubscribers() });
});

router.delete('/subscribers/:id', requireAdmin, (req, res) => {
  const ok = store.deleteSubscriber(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ success: false, message: 'Subscriber not found.' });
  res.json({ success: true, message: 'Subscriber removed.' });
});

// ── Settings ───────────────────────────────────────────────────────────────────
router.get('/settings', requireAdmin, (req, res) => {
  res.json({ success: true, settings: store.getSettings() });
});

router.put('/settings', requireAdmin, (req, res) => {
  const settings = store.updateSettings(req.body);
  res.json({ success: true, message: 'Settings updated.', settings });
});

module.exports = router;