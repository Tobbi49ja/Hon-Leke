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

// Ensure upload dirs exist
[imageDir, videoDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Route video files to /video, images to /image
    cb(null, file.fieldname === 'video' ? videoDir : imageDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname).toLowerCase());
  }
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'video') {
    cb(null, /mp4|webm|mov|avi|mkv/.test(path.extname(file.originalname).toLowerCase()));
  } else {
    cb(null, /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase()));
  }
};

// ── KEY CHANGE: upload.fields() instead of upload.single() ────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB covers videos
}).fields([
  { name: 'images', maxCount: 10 }, // multiple images
  { name: 'image',  maxCount: 1  }, // legacy single image (backwards compat)
  { name: 'video',  maxCount: 1  }  // optional video file
]);

// ── Wrap multer in a promise so async/await works cleanly ──────────────────────
function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ── Resolve one or more images ─────────────────────────────────────────────────
// Returns { coverImage, allImages }
//   coverImage — string path used as the main/cover image (for slider, card thumbnail)
//   allImages  — array of all image paths (for gallery display in post)
async function resolveImages(req, existingImage, existingImages) {
  const files      = req.files || {};
  const imageFiles = files['images'] || files['image'] || [];
  const coverIdx   = parseInt(req.body.coverIndex) || 0;

  if (!imageFiles.length) {
    // No new files uploaded — keep existing values
    const imagePath = req.body.imagePath;
    if (imagePath !== undefined && imagePath !== '') {
      return { coverImage: imagePath, allImages: [imagePath] };
    }
    return {
      coverImage:  existingImage  || '',
      allImages:   existingImages || (existingImage ? [existingImage] : [])
    };
  }

  // Upload each image (to Cloudinary or local disk)
  const resolvedPaths = await Promise.all(
    imageFiles.map(async (file) => {
      if (uploadToCloud) {
        try {
          return await uploadToCloud(file.path, 'image');
        } catch(e) {
          console.error('Cloudinary image upload failed:', e.message);
          return 'image/' + file.filename;
        }
      }
      return 'image/' + file.filename;
    })
  );

  const safeIdx    = Math.min(coverIdx, resolvedPaths.length - 1);
  const coverImage = resolvedPaths[safeIdx];

  return { coverImage, allImages: resolvedPaths };
}

// ── Resolve video ──────────────────────────────────────────────────────────────
async function resolveVideo(req, existingVideoSrc) {
  const files     = req.files || {};
  const videoFile = (files['video'] || [])[0];
  const videoType = req.body.videoType || 'none';
  const videoUrl  = req.body.videoUrl  || '';
  const hasVideo  = req.body.hasVideo === 'true' || req.body.hasVideo === true;

  if (!hasVideo) return { hasVideo: false, videoType: 'none', videoSrc: '', videoUrl: '' };

  // YouTube / embed URL
  if (videoType === 'youtube' && videoUrl) {
    return { hasVideo: true, videoType: 'youtube', videoSrc: '', videoUrl };
  }

  // Uploaded video file
  if (videoFile) {
    let src;
    if (uploadToCloud) {
      try {
        src = await uploadToCloud(videoFile.path, 'video');
      } catch(e) {
        console.error('Cloudinary video upload failed:', e.message);
        src = 'video/' + videoFile.filename;
      }
    } else {
      src = 'video/' + videoFile.filename;
    }
    return { hasVideo: true, videoType: 'upload', videoSrc: src, videoUrl: '' };
  }

  // No new video — keep existing
  if (existingVideoSrc) {
    return { hasVideo: true, videoType: req.body.videoType || 'upload', videoSrc: existingVideoSrc, videoUrl };
  }

  return { hasVideo: false, videoType: 'none', videoSrc: '', videoUrl: '' };
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
router.get('/stats', requireAdmin, (req, res) => {
  res.json({ success: true, stats: store.getStats() });
});

// ── Posts ──────────────────────────────────────────────────────────────────────
router.get('/posts', requireAdmin, (req, res) => {
  res.json({ success: true, posts: store.getAllPosts() });
});

// CREATE POST
router.post('/posts', requireAdmin, async (req, res) => {
  try {
    await runUpload(req, res);

    const { title, excerpt, content, category, date, featured } = req.body;
    if (!title || !excerpt || !content || !category)
      return res.status(400).json({ success: false, message: 'Title, excerpt, content and category are required.' });

    const { coverImage, allImages } = await resolveImages(req, '', []);
    const videoData = await resolveVideo(req, '');

    const post = store.createPost({
      title, excerpt, content, category, date,
      featured: featured === 'true' || featured === true,
      image:    coverImage,
      images:   allImages,
      ...videoData
    });

    res.json({ success: true, message: 'Post created successfully!', post, postId: post.id });

  } catch(err) {
    console.error('POST /posts error:', err);
    res.status(500).json({ success: false, message: 'Server error creating post: ' + err.message });
  }
});

// UPDATE POST
router.put('/posts/:id', requireAdmin, async (req, res) => {
  try {
    await runUpload(req, res);

    const id       = parseInt(req.params.id);
    const existing = store.getPostById(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Post not found.' });

    const { title, excerpt, content, category, date, featured } = req.body;

    const { coverImage, allImages } = await resolveImages(req, existing.image, existing.images);
    const videoData = await resolveVideo(req, existing.videoSrc);

    const post = store.updatePost(id, {
      title, excerpt, content, category, date,
      featured: featured === 'true' || featured === true,
      image:    coverImage,
      images:   allImages,
      ...videoData
    });

    res.json({ success: true, message: 'Post updated successfully!', post });

  } catch(err) {
    console.error('PUT /posts/:id error:', err);
    res.status(500).json({ success: false, message: 'Server error updating post: ' + err.message });
  }
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