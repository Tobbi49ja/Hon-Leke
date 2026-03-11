// server/routes/posts.js
const express = require('express');
const router = express.Router();
const store = require('../data/store');

// GET /api/posts
router.get('/', (req, res) => {
  const { category, search } = req.query;
  let filtered = store.getAllPosts();

  if (category && category !== 'all') {
    filtered = filtered.filter(p => p.category.toLowerCase() === category.toLowerCase());
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.excerpt.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }

  res.json({ success: true, posts: filtered });
});

// GET /api/posts/slider
router.get('/slider', (req, res) => {
  res.json({ success: true, slides: store.getSliderPosts() });
});

// GET /api/posts/categories
router.get('/categories', (req, res) => {
  res.json({ success: true, categories: store.getCategories() });
});

// GET /api/posts/:id
router.get('/:id', (req, res) => {
  const post = store.getPostById(parseInt(req.params.id));
  if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
  res.json({ success: true, post });
});

// GET /api/posts/:id/comments
router.get('/:id/comments', (req, res) => {
  const comments = store.getCommentsByPost(parseInt(req.params.id));
  res.json({ success: true, comments });
});

// POST /api/posts/:id/comments
router.post('/:id/comments', (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }
  const comment = store.addComment(parseInt(req.params.id), name, email, message);
  res.json({ success: true, comment, message: 'Comment posted successfully!' });
});

module.exports = router;
