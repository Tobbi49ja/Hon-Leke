// server/server.js
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path    = require('path');

const { apiLimiter, contactLimiter, requireAdmin } = require('./middleware/index');
const postsRouter   = require('./routes/posts');
const contactRouter = require('./routes/contact');
const adminRouter   = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

//Middleware 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lekeabejide-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

//Static Files
app.use(express.static(path.join(__dirname, '..', 'client', 'public')));
app.use('/admin/assets', express.static(path.join(__dirname, '..', 'admin', 'public')));

// API Routes
app.use('/api', apiLimiter);
app.use('/api/posts', postsRouter);
app.use('/api/contact', contactLimiter, contactRouter);
app.use('/api/subscribe', (req, res, next) => {
  req.url = '/subscribe';
  contactRouter(req, res, next);
});
app.use('/api/admin', adminRouter);

//Client Pages
const clientPages = path.join(__dirname, '..', 'client', 'pages');

app.get('/', (req, res) => res.sendFile(path.join(clientPages, 'home', 'index.html')));
app.get('/about', (req, res) => res.sendFile(path.join(clientPages, 'about', 'index.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(clientPages, 'contact', 'index.html')));
app.get('/post/:id', (req, res) => res.sendFile(path.join(clientPages, 'post', 'index.html')));

//Admin Pages 
const adminPages = path.join(__dirname, '..', 'admin', 'pages');

app.get('/admin', (req, res) => res.redirect('/admin/login'));
app.get('/admin/login', (req, res) => res.sendFile(path.join(adminPages, 'login.html')));
app.get('/admin/dashboard', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'dashboard.html')));
app.get('/admin/posts', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'posts.html')));
app.get('/admin/posts/new', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'post-form.html')));
app.get('/admin/posts/edit/:id', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'post-form.html')));
app.get('/admin/comments', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'comments.html')));
app.get('/admin/messages', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'messages.html')));
app.get('/admin/subscribers', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'subscribers.html')));
app.get('/admin/settings', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'settings.html')));

// 404 page
app.use((req, res) => {
  res.status(404).sendFile(path.join(clientPages, '404', 'index.html'));
});

//Start
app.listen(PORT, () => {
  console.log(`\n✅  Hon. Leke Abejide Blog`);
  console.log(`🌐  Site:  http://localhost:${PORT}`);
  console.log(`🔐  Admin: http://localhost:${PORT}/admin`);
});
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
// server/routes/contact.js
const express = require('express');
const router = express.Router();
const store = require('../data/store');

// POST /api/contact
router.post('/', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address.' });
  }

  store.addContactMessage(name, email, subject, message);

  // Optionally send email if SMTP configured
  if (process.env.SMTP_HOST) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      await transporter.sendMail({
        from: `"${name}" <${process.env.SMTP_USER}>`,
        replyTo: email,
        to: process.env.RECEIVING_EMAIL || 'ayanisolomon1@gmail.com',
        subject: `[Blog Contact] ${subject}`,
        html: `<h2>New Contact Message</h2><p><b>From:</b> ${name} &lt;${email}&gt;</p><p><b>Subject:</b> ${subject}</p><p><b>Message:</b><br>${message.replace(/\n/g, '<br>')}</p>`
      });
    } catch (err) {
      console.error('Email error:', err.message);
    }
  }

  res.json({ success: true, message: 'Your message has been received. Thank you!' });
});

// POST /api/subscribe
router.post('/subscribe', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Invalid email.' });

  const result = store.addSubscriber(email);
  if (result.exists) return res.json({ success: true, message: 'You are already subscribed!' });
  res.json({ success: true, message: 'Thank you for subscribing!' });
});

module.exports = router;
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
// server/middleware/auth.js
const { adminUser } = require('../data/store');

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) {
    return next();
  }
  // API requests
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  res.redirect('/admin/login');
}

module.exports = { requireAdmin };

const { apiLimiter, contactLimiter } = require('./rateLimiter');
const { requireAdmin } = require('./auth');
module.exports = { apiLimiter, contactLimiter, requireAdmin };

// server/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many messages sent. Please try again in 15 minutes.' }
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: { success: false, message: 'Too many requests. Please slow down.' }
});

module.exports = { contactLimiter, apiLimiter };
// server/data/store.js
// Central in-memory data store — replace with MongoDB/SQLite for production
require('dotenv').config();

let posts = [
  {
    id: 1,
    title: "The Chairman House Committee on Customs and Excise, Hon. Leke Abejide, Participates in Youth Townhall Meeting",
    category: "News",
    date: "July 31st '24",
    image: "image/MEETING WITH YOUTH  (1).jpg",
    excerpt: "The Chairman House Committee on Customs and Excise, Hon. Leke Abejide, Participates in Youth Townhall Meeting.",
    content: "Hon. Leke Abejide, Chairman of the House Committee on Customs and Excise, participated in a Youth Townhall Meeting representing the interests of young constituents across Yagba Federal Constituency.",
    featured: true
  },
  {
    id: 2,
    title: "Rep. Leke Abejide of ADC Dissociates Self From National Chairman's Statement, Says Nigeria Needs Patience Not Protest",
    category: "News",
    date: "July 29th '24",
    image: "image/patient not protest (6).jpg",
    excerpt: "Rep. Leke Abejide of ADC dissociates self from National Chairman's statement, says Nigeria needs patience not protest.",
    content: "Rep. Leke Abejide of ADC has dissociated himself from the National Chairman's statement, saying Nigeria needs patience, not protest, at this critical time.",
    featured: false
  },
  {
    id: 3,
    title: "Hon. Leke Abejide Celebrates Barr. Bamidele Suru, Describes Him As A Man of Repute",
    category: "Celebration",
    date: "July 28th '24",
    image: "image/BIRTHDAY  BARRIS.jpg",
    excerpt: "Hon. Leke Abejide celebrates Barr. Bamidele Suru, describes him as a man of repute who has achieved great success.",
    content: `Hon. Leke Abejide the member representing Yagba Federal Constituency celebrates Barr. Bamidele Suru on the occasion of his birthday celebration, he described him as a man of repute who has achieved great success in contributing to human development.

Hon. Abejide in his birthday message said Barr. Bamidele Suru is a politician of repute with an exquisite and quintessential personality who has over the years, demonstrated his love for grassroots development in no small measure.

"Congratulations to my dear friend and brother, Barr. Bamidele Suru a quintessential gentle and brilliant lawyer. He has proven over the years to be a dependable hand in the business of governance and works assiduously for the development of the people."`,
    featured: true
  },
  {
    id: 4,
    title: "Hon. Leke Abejide Takes Immediate Action on Gully Erosion at Ponyan Community",
    category: "Community",
    date: "July 25th '24",
    image: "image/erosion  (1).jpg",
    excerpt: "Hon. Leke Abejide takes immediate action on gully erosion at Ponyan Community.",
    content: "Hon. Leke Abejide, representing Yagba Federal Constituency, has taken immediate action to address the devastating gully erosion affecting the road at Ponyan Community, demonstrating his commitment to infrastructure development.",
    featured: false
  },
  {
    id: 5,
    title: "Hon. Leke Abejide: Inspection and Oversight Visit to Nigerian Customs Service Headquarters",
    category: "Legislative",
    date: "July 18th '24",
    image: "image/Inspector 1.jpg",
    excerpt: "Hon. Leke Abejide conducts inspection and oversight visit to Nigerian Customs Service Headquarters.",
    content: "As Chairman of the House Committee on Customs and Excise, Hon. Leke Abejide conducted a thorough inspection and oversight visit to the Nigerian Customs Service Headquarters to ensure accountability and efficiency in operations.",
    featured: false
  },
  {
    id: 6,
    title: "Rt. Hon Leke Abejide Fulfils Campaign Promise With 100Million Naira Empowerment Fund For Women",
    category: "Empowerment",
    date: "July 13th '24",
    image: "image/Campaign.jpg",
    excerpt: "Rt. Hon Leke Abejide fulfils campaign promise with 100million naira empowerment fund for women across Yagba Federal Constituency.",
    content: "Rt. Hon Leke Abejide has fulfilled his campaign promise by providing a 100 million naira empowerment fund for women across Yagba Federal Constituency, demonstrating his commitment to gender empowerment and economic development.",
    featured: true
  },
  {
    id: 7,
    title: "Leke Abejide Foundation Set To Train Cooperative Societies in Kogi West",
    category: "Foundation",
    date: "July 12th '24",
    image: "image/loan disbursement.jpg",
    excerpt: "Leke Abejide Foundation set to train cooperative societies in Kogi West.",
    content: "The Leke Abejide Foundation has announced plans to train cooperative societies across Kogi West, empowering communities with financial management skills and business development opportunities.",
    featured: false
  },
  {
    id: 8,
    title: "Leke Abejide Foundation Launched Vaccination For Children Across Yagba",
    category: "Foundation",
    date: "June 24th '24",
    image: "image/leke.jpg",
    excerpt: "Leke Abejide Foundation launched vaccination for children across Yagba.",
    content: "The Leke Abejide Foundation launched a comprehensive vaccination drive for children across Yagba, providing free vaccinations to protect children against preventable diseases.",
    featured: true
  },
  {
    id: 9,
    title: "Breach of Privilege by Adeola Fayehun",
    category: "Latest News",
    date: "March 2024",
    image: "image/adeola.png",
    excerpt: "Hon. Leke Abejide on the Breach of Privilege by one Adeola Fayehun who published false information.",
    content: `Adeola Fayehun published false information against the members, House of Representatives on her social media handles.

This information has significantly harmed the reputation of the legislators and disrupted their ability to perform their duties effectively.

These claims were unfounded and not supported by any verifiable evidence.

Hon. Leke Abejide demands legal actions be taken on Adeola, to stop future reoccurrence.`,
    featured: false,
    hasVideo: true,
    videoSrc: "video.mp4"
  }
];

let nextPostId = 10;

let comments = [];
let nextCommentId = 1;

let subscribers = [];
let contactMessages = [];
let nextMsgId = 1;

// Site settings — admin-editable
let siteSettings = {
  heroTitle: "Hon. Leke Abejide",
  heroSubtitle: "Member, House of Representatives · Yagba Federal Constituency · Chairman, House Committee on Customs & Excise",
  footerAbout: "Rt. Hon. Elder Leke Joseph Abejide — Member, House of Representatives, Yagba Federal Constituency, Kogi State.",
  facebookUrl: "https://www.facebook.com/profile.php?id=100051326707777",
  instagramUrl: "https://www.instagram.com/hon.lekeabejide",
  twitterUrl: "#",
  contactEmail: "ayanisolomon1@gmail.com",
  navLinks: [
    { label: "Blog", href: "/" },
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" }
  ]
};

// Admin credentials — loaded from .env (never hardcode these in production)
const adminUser = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'changeme',
  name:     process.env.ADMIN_NAME     || 'Site Administrator'
};

// ── Helper functions ───────────────────────────────────

function getAllPosts() { return [...posts]; }

function getPostById(id) { return posts.find(p => p.id === id) || null; }

function createPost(data) {
  const post = {
    id: nextPostId++,
    title: data.title,
    category: data.category,
    date: data.date || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    image: data.image || '',
    excerpt: data.excerpt,
    content: data.content,
    featured: data.featured === true || data.featured === 'true',
    hasVideo: data.hasVideo === true || data.hasVideo === 'true',
    videoSrc: data.videoSrc || ''
  };
  posts.unshift(post);
  return post;
}

function updatePost(id, data) {
  const idx = posts.findIndex(p => p.id === id);
  if (idx === -1) return null;
  posts[idx] = {
    ...posts[idx],
    title: data.title !== undefined ? data.title : posts[idx].title,
    category: data.category !== undefined ? data.category : posts[idx].category,
    date: data.date !== undefined ? data.date : posts[idx].date,
    image: data.image !== undefined ? data.image : posts[idx].image,
    excerpt: data.excerpt !== undefined ? data.excerpt : posts[idx].excerpt,
    content: data.content !== undefined ? data.content : posts[idx].content,
    featured: data.featured !== undefined ? (data.featured === true || data.featured === 'true') : posts[idx].featured,
    hasVideo: data.hasVideo !== undefined ? (data.hasVideo === true || data.hasVideo === 'true') : posts[idx].hasVideo,
    videoSrc: data.videoSrc !== undefined ? data.videoSrc : posts[idx].videoSrc
  };
  return posts[idx];
}

function deletePost(id) {
  const idx = posts.findIndex(p => p.id === id);
  if (idx === -1) return false;
  posts.splice(idx, 1);
  return true;
}

function toggleFeatured(id) {
  const post = posts.find(p => p.id === id);
  if (!post) return null;
  post.featured = !post.featured;
  return post;
}

function getCategories() {
  return [...new Set(posts.map(p => p.category))];
}

function getSliderPosts() {
  return posts
    .filter(p => p.featured)
    .map(p => ({ id: p.id, image: p.image, title: p.title, link: `/post/${p.id}` }));
}

// Comments
function getCommentsByPost(postId) {
  return comments.filter(c => c.postId === postId);
}

function addComment(postId, name, email, message) {
  const comment = {
    id: nextCommentId++,
    postId,
    name: name.trim(),
    email: email.trim(),
    message: message.trim(),
    date: new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
    approved: true
  };
  comments.push(comment);
  return comment;
}

function deleteComment(id) {
  const idx = comments.findIndex(c => c.id === id);
  if (idx === -1) return false;
  comments.splice(idx, 1);
  return true;
}

function getAllComments() { return [...comments]; }

// Contact messages
function addContactMessage(name, email, subject, message) {
  const msg = {
    id: nextMsgId++,
    name: name.trim(),
    email: email.trim(),
    subject: subject.trim(),
    message: message.trim(),
    date: new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
    read: false
  };
  contactMessages.push(msg);
  return msg;
}

function getAllMessages() { return [...contactMessages]; }
function markMessageRead(id) {
  const msg = contactMessages.find(m => m.id === id);
  if (msg) msg.read = true;
  return msg;
}
function deleteMessage(id) {
  const idx = contactMessages.findIndex(m => m.id === id);
  if (idx === -1) return false;
  contactMessages.splice(idx, 1);
  return true;
}

// Subscribers
function addSubscriber(email) {
  const existing = subscribers.find(s => s.email === email.toLowerCase());
  if (existing) return { exists: true };
  const sub = { id: subscribers.length + 1, email: email.toLowerCase(), date: new Date().toLocaleDateString('en-GB') };
  subscribers.push(sub);
  return { exists: false, sub };
}
function getAllSubscribers() { return [...subscribers]; }
function deleteSubscriber(id) {
  const idx = subscribers.findIndex(s => s.id === id);
  if (idx === -1) return false;
  subscribers.splice(idx, 1);
  return true;
}

// Settings
function getSettings() { return { ...siteSettings }; }
function updateSettings(data) {
  siteSettings = { ...siteSettings, ...data };
  return siteSettings;
}

// Stats
function getStats() {
  return {
    totalPosts: posts.length,
    featuredPosts: posts.filter(p => p.featured).length,
    totalComments: comments.length,
    totalMessages: contactMessages.length,
    unreadMessages: contactMessages.filter(m => !m.read).length,
    totalSubscribers: subscribers.length,
    categories: getCategories().length
  };
}

module.exports = {
  adminUser,
  getAllPosts, getPostById, createPost, updatePost, deletePost, toggleFeatured,
  getCategories, getSliderPosts,
  getCommentsByPost, addComment, deleteComment, getAllComments,
  addContactMessage, getAllMessages, markMessageRead, deleteMessage,
  addSubscriber, getAllSubscribers, deleteSubscriber,
  getSettings, updateSettings,
  getStats
};
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comments — Admin</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <link href="/admin/assets/css/admin.css" rel="stylesheet">
</head>
<body>
<aside class="sidebar">
  <div class="sidebar-brand"><h2>Hon. Leke Abejide</h2><p>Admin Panel</p></div>
  <nav class="sidebar-nav">
    <div class="nav-section">Main</div>
    <a href="/admin/dashboard" class="nav-link" data-page="dashboard"><i class="bi bi-speedometer2"></i> Dashboard</a>
    <div class="nav-section">Content</div>
    <a href="/admin/posts" class="nav-link" data-page="posts"><i class="bi bi-newspaper"></i> Blog Posts</a>
    <a href="/admin/posts/new" class="nav-link" data-page="new-post"><i class="bi bi-plus-circle"></i> New Post</a>
    <div class="nav-section">Engagement</div>
    <a href="/admin/comments" class="nav-link" data-page="comments"><i class="bi bi-chat-left-text"></i> Comments</a>
    <a href="/admin/messages" class="nav-link" data-page="messages"><i class="bi bi-envelope"></i> Messages</a>
    <a href="/admin/subscribers" class="nav-link" data-page="subscribers"><i class="bi bi-people"></i> Subscribers</a>
    <div class="nav-section">Site</div>
    <a href="/admin/settings" class="nav-link" data-page="settings"><i class="bi bi-gear"></i> Settings</a>
    <a href="/" target="_blank" class="nav-link"><i class="bi bi-box-arrow-up-right"></i> View Site</a>
  </nav>
  <div class="sidebar-footer"><span id="admin-name">Admin</span> &nbsp;·&nbsp; <a href="#" id="logout-btn">Logout</a></div>
</aside>

<div class="main-content">
  <div class="topbar">
    <h1 id="page-title">Comments</h1>
    <div class="topbar-actions">
      <div class="admin-avatar" id="admin-avatar">A</div>
    </div>
  </div>

  <div class="page-body">
    <div class="card">
      <div class="card-header">
        <h3><i class="bi bi-chat-left-text"></i> All Comments <span id="comments-count" style="font-weight:400;color:var(--muted)"></span></h3>
      </div>
      <div class="card-body" style="padding:0">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Author</th>
              <th>Email</th>
              <th>Comment</th>
              <th>Post</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="comments-table">
            <tr><td colspan="6" style="text-align:center;padding:32px;color:#718096">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<script src="/admin/assets/js/layout.js"></script>
<script>
initAdminLayout('Comments', 'comments');

async function loadComments() {
  const [commentsRes, postsRes] = await Promise.all([
    adminAPI.get('/api/admin/comments'),
    adminAPI.get('/api/admin/posts')
  ]);
  if (!commentsRes || !postsRes) return;

  const comments = commentsRes.comments;
  const posts = postsRes.posts;
  const postMap = {};
  posts.forEach(p => postMap[p.id] = p);

  document.getElementById('comments-count').textContent = `(${comments.length})`;
  const tbody = document.getElementById('comments-table');

  if (!comments.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:#718096">No comments yet.</td></tr>';
    return;
  }

  tbody.innerHTML = comments.map(c => {
    const post = postMap[c.postId];
    return `
      <tr>
        <td><strong style="font-size:0.875rem">${c.name}</strong></td>
        <td style="color:#718096;font-size:0.8rem">${c.email}</td>
        <td style="max-width:300px;font-size:0.875rem">${c.message.substring(0, 100)}${c.message.length > 100 ? '…' : ''}</td>
        <td>${post ? `<a href="/post/${post.id}" target="_blank" style="color:var(--sidebar);font-size:0.8rem">${post.title.substring(0,40)}…</a>` : `<span style="color:#718096;font-size:0.8rem">Post #${c.postId}</span>`}</td>
        <td style="color:#718096;font-size:0.8rem;white-space:nowrap">${c.date}</td>
        <td>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteComment(${c.id})" title="Delete"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

async function deleteComment(id) {
  confirmDelete('Delete this comment?', async () => {
    const data = await adminAPI.delete(`/api/admin/comments/${id}`);
    if (data) showToast(data.message, data.success ? 'success' : 'error');
    if (data && data.success) loadComments();
  });
}

loadComments();
</script>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard — Admin</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <link href="/admin/assets/css/admin.css" rel="stylesheet">
</head>
<body>
<aside class="sidebar">
  <div class="sidebar-brand"><h2>Hon. Leke Abejide</h2><p>Admin Panel</p></div>
  <nav class="sidebar-nav">
    <div class="nav-section">Main</div>
    <a href="/admin/dashboard" class="nav-link" data-page="dashboard"><i class="bi bi-speedometer2"></i> Dashboard</a>
    <div class="nav-section">Content</div>
    <a href="/admin/posts" class="nav-link" data-page="posts"><i class="bi bi-newspaper"></i> Blog Posts</a>
    <a href="/admin/posts/new" class="nav-link" data-page="new-post"><i class="bi bi-plus-circle"></i> New Post</a>
    <div class="nav-section">Engagement</div>
    <a href="/admin/comments" class="nav-link" data-page="comments"><i class="bi bi-chat-left-text"></i> Comments</a>
    <a href="/admin/messages" class="nav-link" data-page="messages"><i class="bi bi-envelope"></i> Messages</a>
    <a href="/admin/subscribers" class="nav-link" data-page="subscribers"><i class="bi bi-people"></i> Subscribers</a>
    <div class="nav-section">Site</div>
    <a href="/admin/settings" class="nav-link" data-page="settings"><i class="bi bi-gear"></i> Settings</a>
    <a href="/" target="_blank" class="nav-link"><i class="bi bi-box-arrow-up-right"></i> View Site</a>
  </nav>
  <div class="sidebar-footer"><span id="admin-name">Admin</span> &nbsp;·&nbsp; <a href="#" id="logout-btn">Logout</a></div>
</aside>

<div class="main-content">
  <div class="topbar">
    <h1 id="page-title">Dashboard</h1>
    <div class="topbar-actions">
      <a href="/admin/posts/new" class="btn btn-primary btn-sm"><i class="bi bi-plus"></i> New Post</a>
      <div class="admin-avatar" id="admin-avatar">A</div>
    </div>
  </div>

  <div class="page-body">
    <div class="stat-cards" id="stat-cards">
      <div class="stat-card"><div class="stat-icon" style="background:#e8f0f8"><i class="bi bi-newspaper" style="color:#1a3c5e"></i></div><div class="stat-number" id="stat-posts">—</div><div class="stat-label">Total Posts</div></div>
      <div class="stat-card"><div class="stat-icon" style="background:#e8f8ec"><i class="bi bi-star-fill" style="color:#28a745"></i></div><div class="stat-number" id="stat-featured">—</div><div class="stat-label">Featured (Slider)</div></div>
      <div class="stat-card"><div class="stat-icon" style="background:#fff3e0"><i class="bi bi-chat-left-text" style="color:#c8971f"></i></div><div class="stat-number" id="stat-comments">—</div><div class="stat-label">Comments</div></div>
      <div class="stat-card"><div class="stat-icon" style="background:#fde8e8"><i class="bi bi-envelope" style="color:#dc3545"></i></div><div class="stat-number" id="stat-messages">—</div><div class="stat-label">Messages</div></div>
      <div class="stat-card"><div class="stat-icon" style="background:#e8f8f5"><i class="bi bi-people" style="color:#17a2b8"></i></div><div class="stat-number" id="stat-subscribers">—</div><div class="stat-label">Subscribers</div></div>
      <div class="stat-card"><div class="stat-icon" style="background:#f0e8f8"><i class="bi bi-tags" style="color:#6f42c1"></i></div><div class="stat-number" id="stat-categories">—</div><div class="stat-label">Categories</div></div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3><i class="bi bi-newspaper"></i> Recent Posts</h3>
        <a href="/admin/posts" class="btn btn-outline btn-sm">View All</a>
      </div>
      <div class="card-body" style="padding:0">
        <table class="admin-table">
          <thead><tr><th>Image</th><th>Title</th><th>Category</th><th>Date</th><th>Featured</th><th>Actions</th></tr></thead>
          <tbody id="recent-posts-table">
            <tr><td colspan="6" style="text-align:center;padding:24px;color:#718096">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<script src="/admin/assets/js/layout.js"></script>
<script>
initAdminLayout('Dashboard', 'dashboard');

async function loadDashboard() {
  const [statsRes, postsRes] = await Promise.all([
    adminAPI.get('/api/admin/stats'),
    adminAPI.get('/api/admin/posts')
  ]);
  if (!statsRes || !postsRes) return;

  const s = statsRes.stats;
  document.getElementById('stat-posts').textContent = s.totalPosts;
  document.getElementById('stat-featured').textContent = s.featuredPosts;
  document.getElementById('stat-comments').textContent = s.totalComments;
  document.getElementById('stat-messages').textContent = s.totalMessages;
  document.getElementById('stat-subscribers').textContent = s.totalSubscribers;
  document.getElementById('stat-categories').textContent = s.categories;

  const tbody = document.getElementById('recent-posts-table');
  const posts = postsRes.posts.slice(0, 8);
  if (!posts.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#718096">No posts yet. <a href="/admin/posts/new">Create your first post</a></td></tr>';
    return;
  }
  tbody.innerHTML = posts.map(p => `
    <tr>
      <td>${p.image ? `<img src="/${p.image}" class="post-thumb" onerror="this.style.display='none'">` : '<div style="width:52px;height:40px;background:#eee;border-radius:6px;display:flex;align-items:center;justify-content:center"><i class="bi bi-image text-muted"></i></div>'}</td>
      <td style="max-width:260px"><span style="font-weight:500;font-size:0.875rem">${p.title.substring(0,65)}${p.title.length>65?'…':''}</span></td>
      <td><span class="badge badge-info">${p.category}</span></td>
      <td style="color:#718096;font-size:0.8rem;white-space:nowrap">${p.date}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" ${p.featured ? 'checked' : ''} onchange="toggleFeatured(${p.id}, this)">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <a href="/admin/posts/edit/${p.id}" class="btn btn-outline btn-sm btn-icon" title="Edit"><i class="bi bi-pencil"></i></a>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deletePost(${p.id})" title="Delete"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

async function toggleFeatured(id, checkbox) {
  const data = await adminAPI.patch(`/api/admin/posts/${id}/featured`);
  if (data) showToast(data.message, data.success ? 'success' : 'error');
  if (!data || !data.success) checkbox.checked = !checkbox.checked;
}

async function deletePost(id) {
  confirmDelete('Delete this post permanently?', async () => {
    const data = await adminAPI.delete(`/api/admin/posts/${id}`);
    if (data) showToast(data.message, data.success ? 'success' : 'error');
    if (data && data.success) loadDashboard();
  });
}

loadDashboard();
</script>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Messages — Admin</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <link href="/admin/assets/css/admin.css" rel="stylesheet">
</head>
<body>
<aside class="sidebar">
  <div class="sidebar-brand"><h2>Hon. Leke Abejide</h2><p>Admin Panel</p></div>
  <nav class="sidebar-nav">
    <div class="nav-section">Main</div>
    <a href="/admin/dashboard" class="nav-link" data-page="dashboard"><i class="bi bi-speedometer2"></i> Dashboard</a>
    <div class="nav-section">Content</div>
    <a href="/admin/posts" class="nav-link" data-page="posts"><i class="bi bi-newspaper"></i> Blog Posts</a>
    <a href="/admin/posts/new" class="nav-link" data-page="new-post"><i class="bi bi-plus-circle"></i> New Post</a>
    <div class="nav-section">Engagement</div>
    <a href="/admin/comments" class="nav-link" data-page="comments"><i class="bi bi-chat-left-text"></i> Comments</a>
    <a href="/admin/messages" class="nav-link" data-page="messages"><i class="bi bi-envelope"></i> Messages</a>
    <a href="/admin/subscribers" class="nav-link" data-page="subscribers"><i class="bi bi-people"></i> Subscribers</a>
    <div class="nav-section">Site</div>
    <a href="/admin/settings" class="nav-link" data-page="settings"><i class="bi bi-gear"></i> Settings</a>
    <a href="/" target="_blank" class="nav-link"><i class="bi bi-box-arrow-up-right"></i> View Site</a>
  </nav>
  <div class="sidebar-footer"><span id="admin-name">Admin</span> &nbsp;·&nbsp; <a href="#" id="logout-btn">Logout</a></div>
</aside>

<div class="main-content">
  <div class="topbar">
    <h1 id="page-title">Messages</h1>
    <div class="topbar-actions">
      <div class="admin-avatar" id="admin-avatar">A</div>
    </div>
  </div>

  <div class="page-body">
    <div id="messages-list">
      <div style="text-align:center;padding:40px;color:#718096">Loading messages…</div>
    </div>
  </div>
</div>

<script src="/admin/assets/js/layout.js"></script>
<script>
initAdminLayout('Messages', 'messages');

async function loadMessages() {
  const data = await adminAPI.get('/api/admin/messages');
  if (!data) return;

  const messages = data.messages;
  const container = document.getElementById('messages-list');

  if (!messages.length) {
    container.innerHTML = '<div class="empty-state"><i class="bi bi-envelope-open"></i><p>No messages yet.</p></div>';
    return;
  }

  container.innerHTML = messages.slice().reverse().map(m => `
    <div class="message-card ${!m.read ? 'unread' : ''}" id="msg-${m.id}">
      <div class="message-header">
        <div>
          <div class="message-from">
            <i class="bi bi-person-circle"></i> ${m.name}
            ${!m.read ? '<span class="badge badge-warning" style="margin-left:8px">New</span>' : ''}
          </div>
          <div class="message-meta" style="margin-top:4px">
            <i class="bi bi-envelope"></i> <a href="mailto:${m.email}" style="color:var(--sidebar)">${m.email}</a>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:0.78rem;color:#718096">${m.date}</span>
          ${!m.read ? `<button class="btn btn-outline btn-sm" onclick="markRead(${m.id})"><i class="bi bi-check2"></i> Mark Read</button>` : ''}
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteMessage(${m.id})" title="Delete"><i class="bi bi-trash"></i></button>
        </div>
      </div>
      <div class="message-subject"><strong>Subject:</strong> ${m.subject}</div>
      <div class="message-body" style="margin-top:10px;padding:12px;background:#f8fafc;border-radius:8px">${m.message.replace(/\n/g, '<br>')}</div>
    </div>
  `).join('');
}

async function markRead(id) {
  const data = await adminAPI.patch(`/api/admin/messages/${id}/read`);
  if (data && data.success) loadMessages();
}

async function deleteMessage(id) {
  confirmDelete('Delete this message?', async () => {
    const data = await adminAPI.delete(`/api/admin/messages/${id}`);
    if (data) showToast(data.message, data.success ? 'success' : 'error');
    if (data && data.success) loadMessages();
  });
}

loadMessages();
</script>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Post Form — Admin</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <link href="/admin/assets/css/admin.css" rel="stylesheet">
  <style>
    /* ── Extra styles for media upload (extends admin.css) ── */

    /* Media type pill tabs */
    .media-pills {
      display: flex; gap: 6px; margin-bottom: 18px; flex-wrap: wrap;
    }
    .media-pill {
      padding: 7px 16px; border-radius: 20px; border: 1.5px solid var(--border);
      background: var(--admin-bg); font-size: 0.82rem; font-weight: 600;
      cursor: pointer; color: var(--muted); display: inline-flex; align-items: center;
      gap: 6px; transition: all 0.2s;
    }
    .media-pill.active {
      background: var(--sidebar); border-color: var(--sidebar); color: white;
    }
    .media-panel { display: none; }
    .media-panel.active { display: block; }

    /* Sub tabs (upload vs youtube) */
    .sub-tabs {
      display: flex; border: 1px solid var(--border); border-radius: 8px;
      overflow: hidden; margin-bottom: 16px;
    }
    .sub-tab {
      flex: 1; padding: 8px 12px; text-align: center; background: white;
      border: none; font-size: 0.82rem; font-weight: 600; cursor: pointer;
      color: var(--muted); border-right: 1px solid var(--border); transition: all 0.2s;
    }
    .sub-tab:last-child { border-right: none; }
    .sub-tab.active { background: var(--sidebar); color: white; }
    .sub-panel { display: none; }
    .sub-panel.active { display: block; }

    /* Drop zone */
    .drop-zone {
      border: 2px dashed var(--border); border-radius: 10px;
      padding: 28px 16px; text-align: center; cursor: pointer;
      transition: border-color 0.2s, background 0.2s; position: relative;
      background: #fafbfc;
    }
    .drop-zone:hover, .drop-zone.dragover {
      border-color: var(--sidebar); background: #eef3f9;
    }
    .drop-zone input[type="file"] {
      position: absolute; inset: 0; opacity: 0; cursor: pointer;
      width: 100%; height: 100%;
    }
    .drop-zone i { font-size: 2rem; color: var(--muted); display: block; margin-bottom: 8px; }
    .drop-zone p { font-size: 0.85rem; color: var(--text); margin-bottom: 4px; }
    .drop-zone span { font-size: 0.75rem; color: var(--muted); }

    /* Image gallery grid */
    .img-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 10px; margin-top: 14px;
    }
    .img-thumb {
      position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden;
      border: 2px solid var(--border); background: var(--admin-bg);
    }
    .img-thumb.is-cover { border-color: var(--accent); }
    .img-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .img-thumb-actions {
      position: absolute; inset: 0; background: rgba(0,0,0,0.52);
      display: flex; align-items: center; justify-content: center;
      gap: 6px; opacity: 0; transition: opacity 0.2s;
    }
    .img-thumb:hover .img-thumb-actions { opacity: 1; }
    .img-thumb-actions button {
      width: 28px; height: 28px; border-radius: 50%; border: none;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 0.8rem;
    }
    .btn-set-cover  { background: var(--accent);   color: white; }
    .btn-remove-img { background: var(--danger);    color: white; }
    .cover-tag {
      position: absolute; bottom: 5px; left: 5px;
      background: var(--accent); color: white;
      font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
      padding: 2px 7px; border-radius: 8px; pointer-events: none;
    }

    /* Video preview */
    .video-preview-wrap { display: none; margin-top: 12px; border-radius: 8px; overflow: hidden; background: #000; }
    .video-preview-wrap.show { display: block; }
    .video-preview-wrap video { width: 100%; max-height: 240px; display: block; }
    .video-preview-meta {
      background: #111; padding: 8px 12px;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .video-preview-meta span { font-size: 0.78rem; color: #aaa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* YouTube preview */
    .yt-preview { display: none; margin-top: 12px; border-radius: 8px; overflow: hidden; aspect-ratio: 16/9; }
    .yt-preview.show { display: block; }
    .yt-preview iframe { width: 100%; height: 100%; border: none; display: block; }

    /* Count badge on gallery */
    .gallery-label {
      font-size: 0.78rem; color: var(--muted); margin-top: 10px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .gallery-label strong { color: var(--sidebar); }

    /* Help tip */
    .help-tip {
      font-size: 0.75rem; color: var(--muted); margin-top: 5px;
      display: flex; align-items: flex-start; gap: 5px;
    }
    .help-tip i { margin-top: 1px; flex-shrink: 0; }
  </style>
</head>
<body>

<!-- Sidebar -->
<aside class="sidebar">
  <div class="sidebar-brand"><h2>Hon. Leke Abejide</h2><p>Admin Panel</p></div>
  <nav class="sidebar-nav">
    <div class="nav-section">Main</div>
    <a href="/admin/dashboard" class="nav-link" data-page="dashboard"><i class="bi bi-speedometer2"></i> Dashboard</a>
    <div class="nav-section">Content</div>
    <a href="/admin/posts" class="nav-link" data-page="posts"><i class="bi bi-newspaper"></i> Blog Posts</a>
    <a href="/admin/posts/new" class="nav-link" data-page="new-post"><i class="bi bi-plus-circle"></i> New Post</a>
    <div class="nav-section">Engagement</div>
    <a href="/admin/comments" class="nav-link" data-page="comments"><i class="bi bi-chat-left-text"></i> Comments</a>
    <a href="/admin/messages" class="nav-link" data-page="messages"><i class="bi bi-envelope"></i> Messages</a>
    <a href="/admin/subscribers" class="nav-link" data-page="subscribers"><i class="bi bi-people"></i> Subscribers</a>
    <div class="nav-section">Site</div>
    <a href="/admin/settings" class="nav-link" data-page="settings"><i class="bi bi-gear"></i> Settings</a>
    <a href="/" target="_blank" class="nav-link"><i class="bi bi-box-arrow-up-right"></i> View Site</a>
  </nav>
  <div class="sidebar-footer"><span id="admin-name">Admin</span> &nbsp;·&nbsp; <a href="#" id="logout-btn">Logout</a></div>
</aside>

<!-- Main -->
<div class="main-content">
  <div class="topbar">
    <div style="display:flex;align-items:center;gap:12px">
      <a href="/admin/posts" style="color:#718096;text-decoration:none;display:flex;align-items:center;gap:4px">
        <i class="bi bi-arrow-left"></i>
      </a>
      <h1 id="page-title">New Post</h1>
    </div>
    <div class="topbar-actions">
      <div class="admin-avatar" id="admin-avatar">A</div>
    </div>
  </div>

  <div class="page-body">

    <div class="alert alert-danger" id="form-error"></div>
    <div class="alert alert-success" id="form-success"></div>

    <div style="display:grid;grid-template-columns:1fr 330px;gap:24px;align-items:start">

      <!-- ══════════ LEFT COLUMN ══════════ -->
      <div>

        <!-- Post Content -->
        <div class="card">
          <div class="card-header"><h3><i class="bi bi-file-text"></i> Post Content</h3></div>
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">Title <span style="color:#dc3545">*</span></label>
              <input type="text" class="form-control" id="post-title" placeholder="Enter post title…">
            </div>
            <div class="form-group">
              <label class="form-label">Excerpt / Summary <span style="color:#dc3545">*</span></label>
              <textarea class="form-control" id="post-excerpt" rows="3" placeholder="Brief summary shown on blog cards…"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Full Content <span style="color:#dc3545">*</span></label>
              <textarea class="form-control" id="post-content" rows="16"
                placeholder="Full article content…&#10;&#10;Separate paragraphs with a blank line."
                style="min-height:320px;font-family:Georgia,serif;font-size:0.95rem;line-height:1.75"></textarea>
              <div class="help-tip"><i class="bi bi-info-circle"></i> Separate paragraphs with a blank line for proper formatting.</div>
            </div>
          </div>
        </div>

        <!-- ══ MEDIA CARD ══ -->
        <div class="card">
          <div class="card-header">
            <h3><i class="bi bi-images"></i> Media</h3>
            <span style="font-size:0.78rem;color:var(--muted)">Images &amp; / or Video</span>
          </div>
          <div class="card-body">

            <!-- Media type selector -->
            <div class="media-pills">
              <button class="media-pill active" onclick="switchMedia(this,'panel-images')" type="button">
                <i class="bi bi-images"></i> Images Only
              </button>
              <button class="media-pill" onclick="switchMedia(this,'panel-video')" type="button">
                <i class="bi bi-play-circle"></i> Video Only
              </button>
              <button class="media-pill" onclick="switchMedia(this,'panel-both')" type="button">
                <i class="bi bi-collection-play"></i> Images + Video
              </button>
            </div>

            <!-- ── PANEL: Images Only ── -->
            <div class="media-panel active" id="panel-images">
              <div class="help-tip" style="margin-bottom:12px">
                <i class="bi bi-info-circle"></i>
                Upload one or more photos. Star the one you want as the <strong>cover thumbnail</strong>.
              </div>
              <div class="drop-zone" id="dz-images">
                <input type="file" id="input-images" accept="image/*" multiple onchange="handleImages(this.files,'main')">
                <i class="bi bi-cloud-upload"></i>
                <p><strong>Drag &amp; drop images or click to browse</strong></p>
                <span>JPG · PNG · WebP · GIF — max 5 MB each</span>
              </div>
              <div id="gallery-images" class="img-gallery"></div>
              <div class="gallery-label" id="gallery-images-label" style="display:none">
                <span><strong id="gallery-images-count">0</strong> image(s) uploaded</span>
                <button type="button" onclick="clearImages('main')" class="btn btn-sm"
                  style="background:none;border:none;color:var(--danger);cursor:pointer;padding:0;font-size:0.78rem">
                  <i class="bi bi-x-circle"></i> Clear all
                </button>
              </div>
            </div>

            <!-- ── PANEL: Video Only ── -->
            <div class="media-panel" id="panel-video">
              <div class="sub-tabs">
                <button type="button" class="sub-tab active" onclick="switchSub(this,'svid-upload')">
                  <i class="bi bi-upload"></i> Upload File
                </button>
                <button type="button" class="sub-tab" onclick="switchSub(this,'svid-youtube')">
                  <i class="bi bi-youtube"></i> YouTube / Embed
                </button>
              </div>

              <!-- Upload -->
              <div class="sub-panel active" id="svid-upload">
                <div class="drop-zone" id="dz-video">
                  <input type="file" id="input-video" accept="video/*" onchange="handleVideo(this.files[0])">
                  <i class="bi bi-film"></i>
                  <p><strong>Drag &amp; drop a video or click to browse</strong></p>
                  <span>MP4 · WebM · MOV — max 200 MB</span>
                </div>
                <div class="video-preview-wrap" id="vid-preview-wrap">
                  <video id="vid-preview" controls></video>
                  <div class="video-preview-meta">
                    <span id="vid-filename">—</span>
                    <button type="button" class="btn btn-danger btn-sm" onclick="clearVideo()">
                      <i class="bi bi-x"></i> Remove
                    </button>
                  </div>
                </div>
              </div>

              <!-- YouTube -->
              <div class="sub-panel" id="svid-youtube">
                <div class="form-group">
                  <label class="form-label">YouTube / Vimeo URL</label>
                  <input type="url" class="form-control" id="input-yt-url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    oninput="previewYT(this.value)">
                </div>
                <div class="yt-preview" id="yt-preview">
                  <iframe id="yt-iframe" allowfullscreen></iframe>
                </div>
                <div class="help-tip"><i class="bi bi-info-circle"></i> YouTube and Vimeo URLs are auto-converted to embed format.</div>
              </div>
            </div>

            <!-- ── PANEL: Images + Video ── -->
            <div class="media-panel" id="panel-both">

              <!-- Images part -->
              <p style="font-size:0.82rem;font-weight:600;color:var(--text);margin-bottom:10px">
                <i class="bi bi-images" style="color:var(--sidebar)"></i> &nbsp;Photos
              </p>
              <div class="drop-zone" id="dz-both-images">
                <input type="file" id="input-both-images" accept="image/*" multiple onchange="handleImages(this.files,'both')">
                <i class="bi bi-cloud-upload"></i>
                <p><strong>Drag &amp; drop images or click to browse</strong></p>
                <span>Multiple images supported</span>
              </div>
              <div id="gallery-both" class="img-gallery"></div>
              <div class="gallery-label" id="gallery-both-label" style="display:none;margin-bottom:20px">
                <span><strong id="gallery-both-count">0</strong> image(s)</span>
                <button type="button" onclick="clearImages('both')" class="btn btn-sm"
                  style="background:none;border:none;color:var(--danger);cursor:pointer;padding:0;font-size:0.78rem">
                  <i class="bi bi-x-circle"></i> Clear all
                </button>
              </div>

              <hr style="border:none;border-top:1px solid var(--border);margin:18px 0">

              <!-- Video part -->
              <p style="font-size:0.82rem;font-weight:600;color:var(--text);margin-bottom:10px">
                <i class="bi bi-play-circle" style="color:var(--sidebar)"></i> &nbsp;Video
              </p>
              <div class="sub-tabs">
                <button type="button" class="sub-tab active" onclick="switchSub(this,'sboth-upload')">
                  <i class="bi bi-upload"></i> Upload File
                </button>
                <button type="button" class="sub-tab" onclick="switchSub(this,'sboth-youtube')">
                  <i class="bi bi-youtube"></i> YouTube / Embed
                </button>
              </div>
              <div class="sub-panel active" id="sboth-upload">
                <div class="drop-zone">
                  <input type="file" id="input-both-video" accept="video/*" onchange="handleVideo(this.files[0],'both')">
                  <i class="bi bi-film"></i>
                  <p><strong>Drag &amp; drop a video or click to browse</strong></p>
                  <span>MP4 · WebM · MOV</span>
                </div>
                <div class="video-preview-wrap" id="both-vid-preview-wrap">
                  <video id="both-vid-preview" controls></video>
                  <div class="video-preview-meta">
                    <span id="both-vid-filename">—</span>
                    <button type="button" class="btn btn-danger btn-sm" onclick="clearVideo('both')">
                      <i class="bi bi-x"></i> Remove
                    </button>
                  </div>
                </div>
              </div>
              <div class="sub-panel" id="sboth-youtube">
                <div class="form-group">
                  <label class="form-label">YouTube / Vimeo URL</label>
                  <input type="url" class="form-control" id="input-both-yt"
                    placeholder="https://www.youtube.com/watch?v=…"
                    oninput="previewYT(this.value,'both-yt-preview','both-yt-iframe')">
                </div>
                <div class="yt-preview" id="both-yt-preview">
                  <iframe id="both-yt-iframe" allowfullscreen></iframe>
                </div>
              </div>
            </div>

          </div>
        </div>
        <!-- end media card -->

      </div>
      <!-- end left col -->

      <!-- ══════════ RIGHT COLUMN ══════════ -->
      <div>

        <!-- Post Settings -->
        <div class="card">
          <div class="card-header"><h3><i class="bi bi-gear"></i> Post Settings</h3></div>
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">Category <span style="color:#dc3545">*</span></label>
              <input type="text" class="form-control" id="post-category"
                placeholder="e.g. News, Community, Foundation…" list="category-list">
              <datalist id="category-list"></datalist>
            </div>
            <div class="form-group">
              <label class="form-label">Date</label>
              <input type="text" class="form-control" id="post-date" placeholder="e.g. July 31st '24">
              <div class="help-tip"><i class="bi bi-info-circle"></i> Leave blank to use today's date.</div>
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-check">
                <input type="checkbox" id="post-featured">
                <span style="font-size:0.875rem">Add to Hero Slider</span>
              </label>
              <div class="help-tip" style="margin-top:6px"><i class="bi bi-info-circle"></i> Featured posts appear in the homepage hero slider.</div>
            </div>
          </div>
        </div>

        <!-- Save / Actions -->
        <div class="card">
          <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
            <button class="btn btn-primary" id="save-btn"
              style="width:100%;justify-content:center;padding:12px">
              <i class="bi bi-check-lg"></i>
              <span id="save-btn-text">Save Post</span>
            </button>
            <div id="edit-view-link" style="display:none">
              <a href="#" id="view-post-link" target="_blank" class="btn btn-outline"
                style="width:100%;justify-content:center">
                <i class="bi bi-eye"></i> View Post
              </a>
            </div>
            <div id="delete-wrap" style="display:none">
              <button type="button" class="btn btn-danger"
                style="width:100%;justify-content:center" onclick="deletePost()">
                <i class="bi bi-trash"></i> Delete Post
              </button>
            </div>
          </div>
        </div>

      </div>
      <!-- end right col -->

    </div>
  </div>
</div>

<script src="/admin/assets/js/layout.js"></script>
<script>
/* ============================================================
   Post Form — extended with multi-image + video support
   Uses existing adminAPI, showToast, confirmDelete from layout.js
   ============================================================ */

  const pathParts = window.location.pathname.split('/');
  const editId    = pathParts[pathParts.length - 1];
  const isEdit    = pathParts.includes('edit') && !isNaN(editId);

  initAdminLayout(isEdit ? 'Edit Post' : 'New Post', isEdit ? 'posts' : 'new-post');

  /* ── State ── */
  const images = {
    main: [],   // { file, url, iscover }
    both: []
  };
  let videoFile   = null;   // File object
  let videoType   = 'none'; // 'upload' | 'youtube' | 'none'
  let videoUrl    = '';     // embed url if youtube

  /* ════════════════════════════════
     MEDIA PANEL SWITCHING
  ════════════════════════════════ */
  function switchMedia(btn, panelId) {
    document.querySelectorAll('.media-pill').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.media-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(panelId).classList.add('active');
  }

  function switchSub(btn, panelId) {
    const parent = btn.closest('.card-body, .media-panel, .sub-panel');
    const container = btn.closest('.media-panel, .card-body');
    container.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
    container.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(panelId).classList.add('active');
  }

  /* ════════════════════════════════
     IMAGE HANDLING
  ════════════════════════════════ */
  function handleImages(files, ctx) {
    ctx = ctx || 'main';
    Array.from(files).forEach(function(file) {
      if (!file.type.startsWith('image/')) return;
      if (file.size > 5 * 1024 * 1024) {
        showToast('"' + file.name + '" is too large (max 5 MB)', 'error'); return;
      }
      const reader = new FileReader();
      reader.onload = function(e) {
        const arr = images[ctx];
        arr.push({ file: file, url: e.target.result, iscover: arr.length === 0 });
        renderGallery(ctx);
      };
      reader.readAsDataURL(file);
    });
  }

  function renderGallery(ctx) {
    const galleryId = ctx === 'both' ? 'gallery-both' : 'gallery-images';
    const labelId   = ctx === 'both' ? 'gallery-both-label' : 'gallery-images-label';
    const countId   = ctx === 'both' ? 'gallery-both-count' : 'gallery-images-count';
    const gallery   = document.getElementById(galleryId);
    const label     = document.getElementById(labelId);
    const arr       = images[ctx];

    if (!arr.length) {
      gallery.innerHTML = '';
      label.style.display = 'none';
      return;
    }

    label.style.display = 'flex';
    document.getElementById(countId).textContent = arr.length;

    gallery.innerHTML = arr.map(function(img, i) {
      return '<div class="img-thumb' + (img.iscover ? ' is-cover' : '') + '">' +
        (img.iscover ? '<span class="cover-tag">Cover</span>' : '') +
        '<img src="' + img.url + '" alt="img ' + (i+1) + '">' +
        '<div class="img-thumb-actions">' +
          '<button type="button" class="btn-set-cover" title="Set as cover" onclick="setCover(\'' + ctx + '\',' + i + ')"><i class="bi bi-star-fill"></i></button>' +
          '<button type="button" class="btn-remove-img" title="Remove" onclick="removeImage(\'' + ctx + '\',' + i + ')"><i class="bi bi-trash"></i></button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function setCover(ctx, idx) {
    images[ctx].forEach(function(img, i) { img.iscover = i === idx; });
    renderGallery(ctx);
  }

  function removeImage(ctx, idx) {
    images[ctx].splice(idx, 1);
    if (images[ctx].length && !images[ctx].some(function(i) { return i.iscover; })) {
      images[ctx][0].iscover = true;
    }
    renderGallery(ctx);
  }

  function clearImages(ctx) {
    images[ctx] = [];
    renderGallery(ctx);
  }

  /* Drag-and-drop for image zones */
  ['dz-images','dz-both-images'].forEach(function(id) {
    const zone = document.getElementById(id);
    if (!zone) return;
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', function() { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', function(e) {
      e.preventDefault(); zone.classList.remove('dragover');
      handleImages(e.dataTransfer.files, id === 'dz-both-images' ? 'both' : 'main');
    });
  });

  /* ════════════════════════════════
     VIDEO HANDLING
  ════════════════════════════════ */
  function handleVideo(file, ctx) {
    if (!file) return;
    ctx = ctx || 'main';
    videoFile = file;
    videoType = 'upload';

    const wrapId   = ctx === 'both' ? 'both-vid-preview-wrap' : 'vid-preview-wrap';
    const previewId = ctx === 'both' ? 'both-vid-preview' : 'vid-preview';
    const nameId    = ctx === 'both' ? 'both-vid-filename' : 'vid-filename';

    const wrap    = document.getElementById(wrapId);
    const preview = document.getElementById(previewId);
    const nameEl  = document.getElementById(nameId);

    preview.src = URL.createObjectURL(file);
    if (nameEl) nameEl.textContent = file.name;
    wrap.classList.add('show');
  }

  function clearVideo(ctx) {
    ctx = ctx || 'main';
    videoFile = null; videoType = 'none'; videoUrl = '';
    const wrapId = ctx === 'both' ? 'both-vid-preview-wrap' : 'vid-preview-wrap';
    const previewId = ctx === 'both' ? 'both-vid-preview' : 'vid-preview';
    const inputId   = ctx === 'both' ? 'input-both-video' : 'input-video';
    const wrap    = document.getElementById(wrapId);
    const preview = document.getElementById(previewId);
    const input   = document.getElementById(inputId);
    if (preview) preview.src = '';
    if (wrap)    wrap.classList.remove('show');
    if (input)   input.value = '';
  }

  /* YouTube / Vimeo embed */
  function previewYT(url, previewId, iframeId) {
    previewId = previewId || 'yt-preview';
    iframeId  = iframeId  || 'yt-iframe';
    const preview = document.getElementById(previewId);
    const iframe  = document.getElementById(iframeId);
    if (!url || !preview || !iframe) return;

    const embed = toEmbedUrl(url);
    if (embed) {
      iframe.src = embed;
      preview.classList.add('show');
      videoType = 'youtube';
      videoUrl  = embed;
    } else {
      preview.classList.remove('show');
    }
  }

  function toEmbedUrl(url) {
    var yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (yt) return 'https://www.youtube.com/embed/' + yt[1] + '?rel=0';
    var vm = url.match(/vimeo\.com\/(\d+)/);
    if (vm) return 'https://player.vimeo.com/video/' + vm[1];
    return null;
  }

  /* ════════════════════════════════
     LOAD CATEGORIES
  ════════════════════════════════ */
  async function loadCategories() {
    const data = await adminAPI.get('/api/posts/categories');
    if (!data) return;
    const dl = document.getElementById('category-list');
    (data.categories || []).forEach(function(c) {
      const o = document.createElement('option'); o.value = c; dl.appendChild(o);
    });
  }

  /* ════════════════════════════════
     LOAD POST FOR EDIT
  ════════════════════════════════ */
  async function loadPost() {
    if (!isEdit) return;
    document.getElementById('page-title').textContent = 'Edit Post';
    document.getElementById('save-btn-text').textContent = 'Update Post';
    document.getElementById('edit-view-link').style.display = 'block';
    document.getElementById('delete-wrap').style.display = 'block';
    document.getElementById('view-post-link').href = '/post/' + editId;

    const data = await adminAPI.get('/api/admin/posts');
    if (!data) return;
    const post = data.posts.find(function(p) { return p.id === parseInt(editId); });
    if (!post) { showToast('Post not found', 'error'); return; }

    document.getElementById('post-title').value    = post.title    || '';
    document.getElementById('post-excerpt').value  = post.excerpt  || '';
    document.getElementById('post-content').value  = post.content  || '';
    document.getElementById('post-category').value = post.category || '';
    document.getElementById('post-date').value     = post.date     || '';
    document.getElementById('post-featured').checked = !!post.featured;

    /* Load existing images into gallery */
    if (post.images && post.images.length) {
      post.images.forEach(function(src, idx) {
        images.main.push({ file: null, url: '/' + src, iscover: idx === 0 });
      });
      renderGallery('main');
    } else if (post.image) {
      images.main.push({ file: null, url: '/' + post.image, iscover: true });
      renderGallery('main');
    }

    /* Load existing video */
    if (post.videoType === 'youtube' && post.videoUrl) {
      document.getElementById('input-yt-url').value = post.videoUrl;
      previewYT(post.videoUrl);
      // Switch to video panel + youtube sub
      const vidPill = document.querySelector('.media-pill:nth-child(2)');
      if (vidPill) switchMedia(vidPill, 'panel-video');
      const ytTab = document.querySelector('#panel-video .sub-tab:nth-child(2)');
      if (ytTab) switchSub(ytTab, 'svid-youtube');
    }
  }

  /* ════════════════════════════════
     SAVE POST
  ════════════════════════════════ */
  async function savePost() {
    const errorEl   = document.getElementById('form-error');
    const successEl = document.getElementById('form-success');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    const title    = document.getElementById('post-title').value.trim();
    const excerpt  = document.getElementById('post-excerpt').value.trim();
    const content  = document.getElementById('post-content').value.trim();
    const category = document.getElementById('post-category').value.trim();

    if (!title || !excerpt || !content || !category) {
      errorEl.textContent = 'Please fill in all required fields (Title, Category, Excerpt, Content).';
      errorEl.classList.add('show');
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving…';

    /* Determine active image context */
    const activePill  = document.querySelector('.media-pill.active');
    const pillText    = activePill ? activePill.textContent.trim() : '';
    const imgCtx      = pillText.includes('Both') ? 'both' : 'main';
    const activeImgs  = images[imgCtx];

    const formData = new FormData();
    formData.append('title',    title);
    formData.append('excerpt',  excerpt);
    formData.append('content',  content);
    formData.append('category', category);
    formData.append('date',     document.getElementById('post-date').value.trim());
    formData.append('featured', document.getElementById('post-featured').checked);
    formData.append('hasVideo', videoType !== 'none');
    formData.append('videoType', videoType);
    formData.append('videoUrl',  videoUrl);

    /* Attach images */
    var coverIndex = 0;
    activeImgs.forEach(function(img, idx) {
      if (img.file) formData.append('images', img.file);
      if (img.iscover) coverIndex = idx;
    });
    formData.append('coverIndex', coverIndex);

    /* Attach video file */
    if (videoFile && videoType === 'upload') {
      formData.append('video', videoFile);
    }

    try {
      const url    = isEdit ? '/api/admin/posts/' + editId : '/api/admin/posts';
      const method = isEdit ? 'PUT' : 'POST';
      const res    = await fetch(url, { method: method, body: formData });
      const data   = await res.json();

      if (data.success) {
        showToast(data.message || (isEdit ? 'Post updated!' : 'Post saved!'), 'success');
        successEl.textContent = data.message || 'Saved successfully.';
        successEl.classList.add('show');
        if (!isEdit) {
          setTimeout(function() { window.location.href = '/admin/posts'; }, 1400);
        } else {
          document.getElementById('edit-view-link').style.display = 'block';
          document.getElementById('view-post-link').href = '/post/' + editId;
        }
      } else {
        errorEl.textContent = data.message || 'Something went wrong.';
        errorEl.classList.add('show');
        errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch(e) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-lg"></i> <span id="save-btn-text">' + (isEdit ? 'Update Post' : 'Save Post') + '</span>';
    }
  }

  /* ════════════════════════════════
     DELETE POST
  ════════════════════════════════ */
  async function deletePost() {
    confirmDelete('Delete this post permanently? This cannot be undone.', async function() {
      const data = await adminAPI.delete('/api/admin/posts/' + editId);
      if (data) showToast(data.message, data.success ? 'success' : 'error');
      if (data && data.success) window.location.href = '/admin/posts';
    });
  }

  /* ════════════════════════════════
     INIT
  ════════════════════════════════ */
  document.getElementById('save-btn').addEventListener('click', savePost);

  loadCategories();
  loadPost();
</script>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Settings — Admin</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <link href="/admin/assets/css/admin.css" rel="stylesheet">
</head>
<body>
<aside class="sidebar">
  <div class="sidebar-brand"><h2>Hon. Leke Abejide</h2><p>Admin Panel</p></div>
  <nav class="sidebar-nav">
    <div class="nav-section">Main</div>
    <a href="/admin/dashboard" class="nav-link" data-page="dashboard"><i class="bi bi-speedometer2"></i> Dashboard</a>
    <div class="nav-section">Content</div>
    <a href="/admin/posts" class="nav-link" data-page="posts"><i class="bi bi-newspaper"></i> Blog Posts</a>
    <a href="/admin/posts/new" class="nav-link" data-page="new-post"><i class="bi bi-plus-circle"></i> New Post</a>
    <div class="nav-section">Engagement</div>
    <a href="/admin/comments" class="nav-link" data-page="comments"><i class="bi bi-chat-left-text"></i> Comments</a>
    <a href="/admin/messages" class="nav-link" data-page="messages"><i class="bi bi-envelope"></i> Messages</a>
    <a href="/admin/subscribers" class="nav-link" data-page="subscribers"><i class="bi bi-people"></i> Subscribers</a>
    <div class="nav-section">Site</div>
    <a href="/admin/settings" class="nav-link" data-page="settings"><i class="bi bi-gear"></i> Settings</a>
    <a href="/" target="_blank" class="nav-link"><i class="bi bi-box-arrow-up-right"></i> View Site</a>
  </nav>
  <div class="sidebar-footer"><span id="admin-name">Admin</span> &nbsp;·&nbsp; <a href="#" id="logout-btn">Logout</a></div>
</aside>

<div class="main-content">
  <div class="topbar">
    <h1 id="page-title">Site Settings</h1>
    <div class="topbar-actions">
      <div class="admin-avatar" id="admin-avatar">A</div>
    </div>
  </div>

  <div class="page-body">
    <div class="alert alert-success" id="settings-success"></div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">

      <div>
        <div class="card">
          <div class="card-header"><h3><i class="bi bi-info-circle"></i> Site Identity</h3></div>
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">Site Title / Name</label>
              <input type="text" class="form-control" id="s-heroTitle" placeholder="Hon. Leke Abejide">
            </div>
            <div class="form-group">
              <label class="form-label">Hero Subtitle</label>
              <input type="text" class="form-control" id="s-heroSubtitle" placeholder="Member, House of Representatives…">
            </div>
            <div class="form-group">
              <label class="form-label">Footer About Text</label>
              <textarea class="form-control" id="s-footerAbout" rows="3" placeholder="Short description for footer…"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Contact Email</label>
              <input type="email" class="form-control" id="s-contactEmail" placeholder="email@example.com">
            </div>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-header"><h3><i class="bi bi-share"></i> Social Media Links</h3></div>
          <div class="card-body">
            <div class="form-group">
              <label class="form-label"><i class="bi bi-facebook" style="color:#1877f2"></i> Facebook URL</label>
              <input type="url" class="form-control" id="s-facebookUrl" placeholder="https://facebook.com/…">
            </div>
            <div class="form-group">
              <label class="form-label"><i class="bi bi-instagram" style="color:#c13584"></i> Instagram URL</label>
              <input type="url" class="form-control" id="s-instagramUrl" placeholder="https://instagram.com/…">
            </div>
            <div class="form-group">
              <label class="form-label"><i class="bi bi-twitter-x"></i> Twitter/X URL</label>
              <input type="url" class="form-control" id="s-twitterUrl" placeholder="https://x.com/…">
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3><i class="bi bi-list-ul"></i> Navigation Links</h3></div>
          <div class="card-body">
            <p style="font-size:0.85rem;color:var(--muted);margin-bottom:16px">Current navigation links. Edit the page files to change navigation structure.</p>
            <div style="display:flex;flex-direction:column;gap:8px" id="nav-preview">
              <div style="display:flex;gap:8px;align-items:center;font-size:0.875rem"><span class="badge badge-info">Blog</span><span style="color:#718096">→</span><code>/</code></div>
              <div style="display:flex;gap:8px;align-items:center;font-size:0.875rem"><span class="badge badge-info">About</span><span style="color:#718096">→</span><code>/about</code></div>
              <div style="display:flex;gap:8px;align-items:center;font-size:0.875rem"><span class="badge badge-info">Contact</span><span style="color:#718096">→</span><code>/contact</code></div>
            </div>
          </div>
        </div>
      </div>

    </div>

    <div style="margin-top:8px">
      <button class="btn btn-primary" id="save-settings-btn" style="padding:12px 32px">
        <i class="bi bi-check-lg"></i> Save Settings
      </button>
    </div>
  </div>
</div>

<script src="/admin/assets/js/layout.js"></script>
<script>
initAdminLayout('Site Settings', 'settings');

async function loadSettings() {
  const data = await adminAPI.get('/api/admin/settings');
  if (!data || !data.settings) return;
  const s = data.settings;
  document.getElementById('s-heroTitle').value = s.heroTitle || '';
  document.getElementById('s-heroSubtitle').value = s.heroSubtitle || '';
  document.getElementById('s-footerAbout').value = s.footerAbout || '';
  document.getElementById('s-contactEmail').value = s.contactEmail || '';
  document.getElementById('s-facebookUrl').value = s.facebookUrl || '';
  document.getElementById('s-instagramUrl').value = s.instagramUrl || '';
  document.getElementById('s-twitterUrl').value = s.twitterUrl || '';
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const btn = document.getElementById('save-settings-btn');
  const successEl = document.getElementById('settings-success');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving…';

  const payload = {
    heroTitle: document.getElementById('s-heroTitle').value.trim(),
    heroSubtitle: document.getElementById('s-heroSubtitle').value.trim(),
    footerAbout: document.getElementById('s-footerAbout').value.trim(),
    contactEmail: document.getElementById('s-contactEmail').value.trim(),
    facebookUrl: document.getElementById('s-facebookUrl').value.trim(),
    instagramUrl: document.getElementById('s-instagramUrl').value.trim(),
    twitterUrl: document.getElementById('s-twitterUrl').value.trim()
  };

  try {
    const data = await adminAPI.put('/api/admin/settings', payload);
    if (data && data.success) {
      showToast('Settings saved!', 'success');
      successEl.textContent = 'Settings updated successfully.';
      successEl.classList.add('show');
      setTimeout(() => successEl.classList.remove('show'), 3000);
    }
  } catch(e) {
    showToast('Error saving settings', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-lg"></i> Save Settings';
  }
});

loadSettings();
</script>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Subscribers — Admin</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <link href="/admin/assets/css/admin.css" rel="stylesheet">
</head>
<body>
<aside class="sidebar">
  <div class="sidebar-brand"><h2>Hon. Leke Abejide</h2><p>Admin Panel</p></div>
  <nav class="sidebar-nav">
    <div class="nav-section">Main</div>
    <a href="/admin/dashboard" class="nav-link" data-page="dashboard"><i class="bi bi-speedometer2"></i> Dashboard</a>
    <div class="nav-section">Content</div>
    <a href="/admin/posts" class="nav-link" data-page="posts"><i class="bi bi-newspaper"></i> Blog Posts</a>
    <a href="/admin/posts/new" class="nav-link" data-page="new-post"><i class="bi bi-plus-circle"></i> New Post</a>
    <div class="nav-section">Engagement</div>
    <a href="/admin/comments" class="nav-link" data-page="comments"><i class="bi bi-chat-left-text"></i> Comments</a>
    <a href="/admin/messages" class="nav-link" data-page="messages"><i class="bi bi-envelope"></i> Messages</a>
    <a href="/admin/subscribers" class="nav-link" data-page="subscribers"><i class="bi bi-people"></i> Subscribers</a>
    <div class="nav-section">Site</div>
    <a href="/admin/settings" class="nav-link" data-page="settings"><i class="bi bi-gear"></i> Settings</a>
    <a href="/" target="_blank" class="nav-link"><i class="bi bi-box-arrow-up-right"></i> View Site</a>
  </nav>
  <div class="sidebar-footer"><span id="admin-name">Admin</span> &nbsp;·&nbsp; <a href="#" id="logout-btn">Logout</a></div>
</aside>

<div class="main-content">
  <div class="topbar">
    <h1 id="page-title">Subscribers</h1>
    <div class="topbar-actions">
      <button class="btn btn-outline btn-sm" id="export-btn"><i class="bi bi-download"></i> Export CSV</button>
      <div class="admin-avatar" id="admin-avatar">A</div>
    </div>
  </div>

  <div class="page-body">
    <div class="card">
      <div class="card-header">
        <h3><i class="bi bi-people"></i> Newsletter Subscribers <span id="sub-count" style="font-weight:400;color:var(--muted)"></span></h3>
      </div>
      <div class="card-body" style="padding:0">
        <table class="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Email</th>
              <th>Subscribed Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="subscribers-table">
            <tr><td colspan="4" style="text-align:center;padding:32px;color:#718096">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<script src="/admin/assets/js/layout.js"></script>
<script>
initAdminLayout('Subscribers', 'subscribers');
let allSubs = [];

async function loadSubscribers() {
  const data = await adminAPI.get('/api/admin/subscribers');
  if (!data) return;
  allSubs = data.subscribers;
  document.getElementById('sub-count').textContent = `(${allSubs.length})`;
  const tbody = document.getElementById('subscribers-table');

  if (!allSubs.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:32px;color:#718096">No subscribers yet.</td></tr>';
    return;
  }

  tbody.innerHTML = allSubs.map((s, i) => `
    <tr>
      <td style="color:#718096;font-size:0.8rem">${i + 1}</td>
      <td><strong style="font-size:0.875rem">${s.email}</strong></td>
      <td style="color:#718096;font-size:0.8rem">${s.date}</td>
      <td>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteSubscriber(${s.id})" title="Remove"><i class="bi bi-person-x"></i></button>
      </td>
    </tr>
  `).join('');
}

async function deleteSubscriber(id) {
  confirmDelete('Remove this subscriber?', async () => {
    const data = await adminAPI.delete(`/api/admin/subscribers/${id}`);
    if (data) showToast(data.message, data.success ? 'success' : 'error');
    if (data && data.success) loadSubscribers();
  });
}

document.getElementById('export-btn').addEventListener('click', () => {
  if (!allSubs.length) { showToast('No subscribers to export', 'error'); return; }
  const csv = 'Email,Date\n' + allSubs.map(s => `${s.email},${s.date}`).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'subscribers.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Subscribers exported!', 'success');
});

loadSubscribers();
</script>
</body>
</html>
// admin/public/js/layout.js — Shared admin utilities

const adminAPI = {
  async get(url) {
    const res = await fetch(url);
    if (res.status === 401) { window.location.href = '/admin/login'; return null; }
    return res.json();
  },
  async post(url, data) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return res.json();
  },
  async put(url, data) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return res.json();
  },
  async patch(url, data) {
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });
    return res.json();
  },
  async delete(url) {
    const res = await fetch(url, { method: 'DELETE' });
    return res.json();
  }
};

function initAdminLayout(pageTitle, activeNav) {
  // Set page title
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = pageTitle;
  document.title = `${pageTitle} — Admin`;

  // Active nav
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    link.classList.toggle('active', link.dataset.page === activeNav);
  });

  // Load admin name
  adminAPI.get('/api/admin/me').then(data => {
    if (!data) return;
    const nameEl = document.getElementById('admin-name');
    const avatarEl = document.getElementById('admin-avatar');
    if (nameEl) nameEl.textContent = data.name;
    if (avatarEl) avatarEl.textContent = (data.name || 'A')[0].toUpperCase();
  }).catch(() => {});

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async e => {
      e.preventDefault();
      await adminAPI.post('/api/admin/logout');
      window.location.href = '/admin/login';
    });
  }
}

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.style.cssText = `padding:12px 18px;border-radius:8px;font-size:0.88rem;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15);color:white;max-width:320px;background:${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#1a3c5e'};animation:fadeInToast 0.3s ease;`;
  toast.innerHTML = `<i class="bi bi-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i> ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function confirmDelete(message, callback) {
  const confirmed = window.confirm(message);
  if (confirmed) callback();
}

// Toast animation
const style = document.createElement('style');
style.textContent = '@keyframes fadeInToast{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
document.head.appendChild(style);
/* Admin Panel CSS */
:root {
  --sidebar: #1a3c5e;
  --sidebar-hover: #2d5f8a;
  --accent: #c8971f;
  --admin-bg: #f4f6f9;
  --white: #ffffff;
  --border: #e0e6ef;
  --text: #2d3748;
  --muted: #718096;
  --success: #28a745;
  --danger: #dc3545;
  --warning: #f0a500;
  --sidebar-width: 240px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', 'Segoe UI', sans-serif; background: var(--admin-bg); color: var(--text); display: flex; min-height: 100vh; }

/* Sidebar */
.sidebar { width: var(--sidebar-width); background: var(--sidebar); color: white; display: flex; flex-direction: column; position: fixed; top: 0; left: 0; bottom: 0; z-index: 100; }
.sidebar-brand { padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
.sidebar-brand h2 { font-size: 0.95rem; color: white; line-height: 1.3; }
.sidebar-brand p { font-size: 0.7rem; opacity: 0.55; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.sidebar-nav { flex: 1; padding: 12px 0; overflow-y: auto; }
.nav-section { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 1.5px; color: rgba(255,255,255,0.35); padding: 12px 18px 6px; }
.nav-link { display: flex; align-items: center; gap: 10px; padding: 10px 18px; color: rgba(255,255,255,0.72); text-decoration: none; font-size: 0.875rem; transition: all 0.2s; border-left: 3px solid transparent; }
.nav-link i { font-size: 1rem; width: 20px; flex-shrink: 0; }
.nav-link:hover, .nav-link.active { color: white; background: rgba(255,255,255,0.08); border-left-color: var(--accent); }
.sidebar-footer { padding: 14px 18px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; color: rgba(255,255,255,0.5); }
.sidebar-footer a { color: rgba(255,255,255,0.7); text-decoration: none; }
.sidebar-footer a:hover { color: white; }

/* Main */
.main-content { margin-left: var(--sidebar-width); flex: 1; display: flex; flex-direction: column; min-height: 100vh; }
.topbar { background: var(--white); border-bottom: 1px solid var(--border); padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 50; }
.topbar h1 { font-size: 1.1rem; font-weight: 600; }
.topbar-actions { display: flex; align-items: center; gap: 12px; }
.admin-avatar { width: 36px; height: 36px; background: var(--sidebar); border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; }
.page-body { padding: 24px 28px; flex: 1; }

/* Stats */
.stat-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card { background: var(--white); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.stat-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; margin-bottom: 12px; }
.stat-number { font-size: 1.9rem; font-weight: 700; line-height: 1; margin-bottom: 6px; }
.stat-label { font-size: 0.78rem; color: var(--muted); }

/* Cards */
.card { background: var(--white); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 20px; }
.card-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.card-header h3 { font-size: 0.95rem; font-weight: 600; }
.card-body { padding: 20px; }

/* Table */
.admin-table { width: 100%; border-collapse: collapse; }
.admin-table th { text-align: left; padding: 10px 14px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); border-bottom: 2px solid var(--border); background: #f8fafc; }
.admin-table td { padding: 12px 14px; border-bottom: 1px solid var(--border); font-size: 0.875rem; vertical-align: middle; }
.admin-table tr:hover td { background: #f8fafc; }
.admin-table tr:last-child td { border-bottom: none; }
.post-thumb { width: 52px; height: 40px; object-fit: cover; border-radius: 6px; background: var(--border); }

/* Badges */
.badge { padding: 4px 10px; border-radius: 20px; font-size: 0.7rem; font-weight: 600; display: inline-block; }
.badge-success { background: #d4edda; color: #155724; }
.badge-warning { background: #fff3cd; color: #856404; }
.badge-info { background: #d1ecf1; color: #0c5460; }
.badge-danger { background: #f8d7da; color: #721c24; }
.badge-secondary { background: #e2e8f0; color: #4a5568; }

/* Buttons */
.btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 0.875rem; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; transition: all 0.2s; }
.btn-primary { background: var(--sidebar); color: white; }
.btn-primary:hover { background: var(--sidebar-hover); }
.btn-success { background: var(--success); color: white; }
.btn-success:hover { background: #218838; }
.btn-danger { background: var(--danger); color: white; }
.btn-danger:hover { background: #c82333; }
.btn-warning { background: var(--warning); color: white; }
.btn-outline { background: transparent; color: var(--text); border: 1px solid var(--border); }
.btn-outline:hover { background: var(--admin-bg); }
.btn-sm { padding: 5px 10px; font-size: 0.78rem; }
.btn-icon { padding: 6px; border-radius: 6px; }

/* Forms */
.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 6px; }
.form-control { width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; font-family: inherit; outline: none; transition: border-color 0.2s; background: white; }
.form-control:focus { border-color: var(--sidebar); }
textarea.form-control { resize: vertical; min-height: 120px; }
.form-check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.form-check input { width: 16px; height: 16px; cursor: pointer; }

/* Alert */
.alert { padding: 12px 16px; border-radius: 8px; font-size: 0.875rem; margin-bottom: 16px; display: none; }
.alert.show { display: block; }
.alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
.alert-danger { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }

/* Image preview */
.img-preview { width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); display: none; margin-top: 10px; }

/* Toggle switch */
.toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; cursor: pointer; inset: 0; background: #ccc; border-radius: 22px; transition: 0.3s; }
.toggle-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.3s; }
input:checked + .toggle-slider { background: var(--sidebar); }
input:checked + .toggle-slider:before { transform: translateX(18px); }

/* Login */
.login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--sidebar) 0%, #2d5f8a 100%); }
.login-card { background: white; border-radius: 16px; padding: 40px; width: 100%; max-width: 400px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
.login-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
.login-logo h1 { font-size: 1.3rem; color: var(--sidebar); }
.login-card p { color: var(--muted); font-size: 0.88rem; margin-bottom: 28px; }

/* Empty state */
.empty-state { text-align: center; padding: 48px 20px; color: var(--muted); }
.empty-state i { font-size: 3rem; margin-bottom: 12px; display: block; }

/* Message card */
.message-card { background: var(--white); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 14px; }
.message-card.unread { border-left: 4px solid var(--accent); }
.message-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.message-from { font-weight: 600; font-size: 0.92rem; }
.message-meta { font-size: 0.78rem; color: var(--muted); }
.message-subject { font-weight: 500; margin-bottom: 8px; }
.message-body { font-size: 0.88rem; color: var(--muted); line-height: 1.6; }

/* Spinner */
.spinner { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; }
.spinner-dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--sidebar); }
@keyframes spin { to { transform: rotate(360deg); } }

/* Responsive */
@media (max-width: 768px) {
  .sidebar { transform: translateX(-100%); transition: transform 0.3s; }
  .sidebar.open { transform: translateX(0); }
  .main-content { margin-left: 0; }
  .stat-cards { grid-template-columns: repeat(2, 1fr); }
  .page-body { padding: 16px; }
}