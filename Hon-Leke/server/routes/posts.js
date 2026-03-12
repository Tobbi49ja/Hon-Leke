// server/routes/posts.js
const express = require('express');
const router  = require('express').Router();
const store   = require('../data/store');

// GET /api/posts — all posts with optional ?category= and ?search=
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

// GET /api/posts/slider — MUST be before /:id
router.get('/slider', async (req, res) => {
  try {
    const slides = await store.getSliderPosts();
    res.json({ success: true, slides });
  } catch (err) {
    console.error('GET /api/posts/slider error:', err);
    res.status(500).json({ success: false, message: 'Failed to load slider.' });
  }
});

// GET /api/posts/categories — MUST be before /:id
router.get('/categories', async (req, res) => {
  try {
    const categories = await store.getCategories();
    res.json({ success: true, categories });
  } catch (err) {
    console.error('GET /api/posts/categories error:', err);
    res.status(500).json({ success: false, message: 'Failed to load categories.' });
  }
});

// GET /api/posts/:id — single post (MongoDB ObjectId string, no parseInt)
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

// GET /api/posts/:id/comments
router.get('/:id/comments', async (req, res) => {
  try {
    const comments = await store.getCommentsByPost(req.params.id);
    res.json({ success: true, comments });
  } catch (err) {
    console.error('GET /api/posts/:id/comments error:', err);
    res.status(500).json({ success: false, message: 'Failed to load comments.' });
  }
});

// POST /api/posts/:id/comments
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