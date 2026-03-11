// server/routes/admin.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const store = require('../data/store');
const { requireAdmin } = require('../middleware/auth');

// ── Multer setup ───────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', '..', 'client', 'public', 'image');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  }
});

// ── Auth ───────────────────────────────────────────────

// POST /api/admin/login
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

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out.' });
});

// GET /api/admin/me
router.get('/me', requireAdmin, (req, res) => {
  res.json({ success: true, name: req.session.adminName || 'Admin' });
});

// ── Stats ──────────────────────────────────────────────
router.get('/stats', requireAdmin, (req, res) => {
  res.json({ success: true, stats: store.getStats() });
});

// ── Posts ──────────────────────────────────────────────

// GET /api/admin/posts
router.get('/posts', requireAdmin, (req, res) => {
  res.json({ success: true, posts: store.getAllPosts() });
});

// POST /api/admin/posts
router.post('/posts', requireAdmin, upload.single('image'), (req, res) => {
  const { title, excerpt, content, category, date, featured, hasVideo, videoSrc, imagePath } = req.body;

  if (!title || !excerpt || !content || !category) {
    return res.status(400).json({ success: false, message: 'Title, excerpt, content and category are required.' });
  }

  let image = '';
  if (req.file) {
    image = 'image/' + req.file.filename;
  } else if (imagePath) {
    image = imagePath;
  }

  const post = store.createPost({ title, excerpt, content, category, date, featured, hasVideo, videoSrc, image });
  res.json({ success: true, message: 'Post created successfully!', post });
});

// PUT /api/admin/posts/:id
router.put('/posts/:id', requireAdmin, upload.single('image'), (req, res) => {
  const id = parseInt(req.params.id);
  const { title, excerpt, content, category, date, featured, hasVideo, videoSrc, imagePath } = req.body;

  const existing = store.getPostById(id);
  if (!existing) return res.status(404).json({ success: false, message: 'Post not found.' });

  let image = existing.image;
  if (req.file) {
    image = 'image/' + req.file.filename;
  } else if (imagePath !== undefined) {
    image = imagePath || existing.image;
  }

  const post = store.updatePost(id, { title, excerpt, content, category, date, featured, hasVideo, videoSrc, image });
  res.json({ success: true, message: 'Post updated successfully!', post });
});

// DELETE /api/admin/posts/:id
router.delete('/posts/:id', requireAdmin, (req, res) => {
  const ok = store.deletePost(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ success: false, message: 'Post not found.' });
  res.json({ success: true, message: 'Post deleted.' });
});

// PATCH /api/admin/posts/:id/featured
router.patch('/posts/:id/featured', requireAdmin, (req, res) => {
  const post = store.toggleFeatured(parseInt(req.params.id));
  if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
  res.json({ success: true, message: post.featured ? 'Added to slider.' : 'Removed from slider.', featured: post.featured });
});

// ── Comments ───────────────────────────────────────────

router.get('/comments', requireAdmin, (req, res) => {
  res.json({ success: true, comments: store.getAllComments() });
});

router.delete('/comments/:id', requireAdmin, (req, res) => {
  const ok = store.deleteComment(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ success: false, message: 'Comment not found.' });
  res.json({ success: true, message: 'Comment deleted.' });
});

// ── Messages ───────────────────────────────────────────

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

// ── Subscribers ────────────────────────────────────────

router.get('/subscribers', requireAdmin, (req, res) => {
  res.json({ success: true, subscribers: store.getAllSubscribers() });
});

router.delete('/subscribers/:id', requireAdmin, (req, res) => {
  const ok = store.deleteSubscriber(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ success: false, message: 'Subscriber not found.' });
  res.json({ success: true, message: 'Subscriber removed.' });
});

// ── Settings ───────────────────────────────────────────

router.get('/settings', requireAdmin, (req, res) => {
  res.json({ success: true, settings: store.getSettings() });
});

router.put('/settings', requireAdmin, (req, res) => {
  const settings = store.updateSettings(req.body);
  res.json({ success: true, message: 'Settings updated.', settings });
});

module.exports = router;
