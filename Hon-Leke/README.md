 ADD this
 // ─────────────────────────────────────────────────────────────────────────────
// PATCH: add these methods to your existing server/data/store.js
// They read/write settings.categories (an array of strings).
// If settings.categories doesn't exist yet it falls back to deriving the list
// from existing posts so nothing breaks on first run.
// ─────────────────────────────────────────────────────────────────────────────

// ── getCategories ─────────────────────────────────────────────────────────────
// Returns the canonical category list from settings.
// Falls back to distinct values across all posts if the key is missing.
async function getCategories() {
  const settings = await getSettings(); // your existing getSettings()
  if (settings.categories && settings.categories.length) {
    return settings.categories;
  }
  // first-run fallback: seed from existing posts
  const posts = await getAllPosts();
  const derived = [...new Set(posts.map(p => p.category).filter(Boolean))].sort();
  return derived;
}

// ── addCategory ───────────────────────────────────────────────────────────────
async function addCategory(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Category name is required.');

  const current = await getSettings();
  const cats    = current.categories ? [...current.categories] : await getCategories();

  if (cats.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`Category "${trimmed}" already exists.`);
  }

  cats.push(trimmed);
  cats.sort((a, b) => a.localeCompare(b));

  await updateSettings({ ...current, categories: cats }); // your existing updateSettings()
  return cats;
}

// ── renameCategory ────────────────────────────────────────────────────────────
// Renames the category in the settings list AND bulk-updates every post that
// uses the old name.
async function renameCategory(oldName, newName) {
  const old     = (oldName || '').trim();
  const next    = (newName || '').trim();
  if (!old || !next) throw new Error('Both old and new names are required.');
  if (old.toLowerCase() === next.toLowerCase()) return; // no-op

  const current = await getSettings();
  const cats    = current.categories ? [...current.categories] : await getCategories();

  const idx = cats.findIndex(c => c.toLowerCase() === old.toLowerCase());
  if (idx === -1) throw new Error(`Category "${old}" not found.`);

  if (cats.some((c, i) => i !== idx && c.toLowerCase() === next.toLowerCase())) {
    throw new Error(`Category "${next}" already exists.`);
  }

  cats[idx] = next;
  cats.sort((a, b) => a.localeCompare(b));

  // Bulk-update all posts that had the old category name
  const Post = require('../models/Post');
  await Post.updateMany(
    { category: { $regex: new RegExp(`^${escapeRegex(old)}$`, 'i') } },
    { $set: { category: next } }
  );

  await updateSettings({ ...current, categories: cats });
  return cats;
}

// ── deleteCategory ────────────────────────────────────────────────────────────
// Removes the category from the settings list.
// Posts that used it are NOT deleted — their category field is left as-is so
// the admin can reassign them. Pass { force: true } to also clear those posts'
// category field (sets it to '').
async function deleteCategory(name, { force = false } = {}) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Category name is required.');

  const current = await getSettings();
  const cats    = current.categories ? [...current.categories] : await getCategories();

  const idx = cats.findIndex(c => c.toLowerCase() === trimmed.toLowerCase());
  if (idx === -1) throw new Error(`Category "${trimmed}" not found.`);

  cats.splice(idx, 1);

  if (force) {
    const Post = require('../models/Post');
    await Post.updateMany(
      { category: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') } },
      { $set: { category: '' } }
    );
  }

  await updateSettings({ ...current, categories: cats });
  return cats;
}

// helper
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Export additions ──────────────────────────────────────────────────────────
// Add these four lines to the module.exports object in your store.js:
//
//   getCategories,
//   addCategory,
//   renameCategory,
//   deleteCategory,

with this
// server/data/store.js
// MongoDB-backed data store
require('dotenv').config();

const Post       = require('../models/post');
const Comment    = require('../models/Comment');
const Subscriber = require('../models/Subscriber');
const Message    = require('../models/Message');
const Settings   = require('../models/Settings');

// ─────────────────────────────────────────────────────────────────────────────
// Admin credentials
// ─────────────────────────────────────────────────────────────────────────────
const adminUser = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'changeme',
  name:     process.env.ADMIN_NAME     || 'Site Administrator'
};

// ─────────────────────────────────────────────────────────────────────────────
// Default site settings
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  heroTitle:    'Hon. Leke Abejide',
  heroSubtitle: 'Member, House of Representatives - Yagba Federal Constituency - Chairman, House Committee on Customs & Excise',
  footerAbout:  'Rt. Hon. Elder Leke Joseph Abejide - Member, House of Representatives, Yagba Federal Constituency, Kogi State.',
  facebookUrl:  'https://www.facebook.com/profile.php?id=100051326707777',
  instagramUrl: 'https://www.instagram.com/hon.lekeabejide',
  twitterUrl:   '#',
  contactEmail: 'ayanisolomon1@gmail.com',
  navLinks: [
    { label: 'Blog',    href: '/' },
    { label: 'About',   href: '/about' },
    { label: 'Contact', href: '/contact' }
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// Seed posts — keep your existing SEED_POSTS array here unchanged
// ─────────────────────────────────────────────────────────────────────────────
const SEED_POSTS = [
  // ... (Keep your existing SEED_POSTS array here)
];

// ─────────────────────────────────────────────────────────────────────────────
// Seed on first boot
// ─────────────────────────────────────────────────────────────────────────────
async function seedIfEmpty() {
  const count = await Post.countDocuments();
  if (count === 0) {
    await Post.insertMany(SEED_POSTS);
    console.log('Seeded', SEED_POSTS.length, 'initial posts.');
  }
  const sc = await Settings.countDocuments({ key: 'site' });
  if (sc === 0) {
    await Settings.create({ key: 'site', value: DEFAULT_SETTINGS });
    console.log('Seeded default site settings.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slug helper — mirrors the one in the Post model
// ─────────────────────────────────────────────────────────────────────────────
function slugify(text) {
  return String(text || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — convert Mongoose docs to plain objects with string IDs
// ─────────────────────────────────────────────────────────────────────────────
function toPlain(doc) {
  if (!doc) return null;
  if (Array.isArray(doc)) return doc.map(toPlain);
  let obj   = doc.toObject ? doc.toObject() : doc;
  const plain = JSON.parse(JSON.stringify(obj));
  if (obj._id) plain.id = obj._id.toString();
  return plain;
}

// ─────────────────────────────────────────────────────────────────────────────
// POSTS
// ─────────────────────────────────────────────────────────────────────────────

async function getAllPosts() {
  const docs = await Post.find({ status: { $ne: 'draft' } })
    .sort({ createdAt: -1 }).lean();
  return toPlain(docs);
}

// Get ALL posts including drafts — used by admin panel only
async function getAllPostsAdmin() {
  const docs = await Post.find().sort({ createdAt: -1 }).lean();
  return toPlain(docs);
}

async function getPostById(id) {
  try {
    const doc = await Post.findById(id).lean();
    return toPlain(doc);
  } catch (e) {
    return null;
  }
}

// Find by slug OR id — supports both /post/my-slug and /post/objectid
async function getPostBySlugOrId(slugOrId) {
  try {
    // Try slug first
    let doc = await Post.findOne({ slug: slugOrId }).lean();
    if (doc) return toPlain(doc);
    // Fall back to MongoDB ObjectId
    doc = await Post.findById(slugOrId).lean();
    return toPlain(doc);
  } catch (e) {
    return null;
  }
}

async function createPost(data) {
  const dateStr = data.date ||
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // Parse tags
  let tags = [];
  if (Array.isArray(data.tags)) {
    tags = data.tags.map(t => t.trim()).filter(Boolean);
  } else if (typeof data.tags === 'string' && data.tags.trim()) {
    tags = data.tags.split(',').map(t => t.trim()).filter(Boolean);
  }

  // Generate slug from title
  const slug = slugify(data.title);

  const doc = await Post.create({
    ...data,
    slug,
    date:     dateStr,
    featured: data.featured === true || data.featured === 'true',
    hasVideo: data.hasVideo === true || data.hasVideo === 'true',
    images:   data.images || (data.image ? [data.image] : []),
    status:   data.status || 'published',
    tags,
    views:    0,
    likes:    0,
  });
  return toPlain(doc);
}

async function updatePost(id, data) {
  try {
    if (data.featured !== undefined) data.featured = (data.featured === true || data.featured === 'true');
    if (data.hasVideo !== undefined) data.hasVideo = (data.hasVideo === true || data.hasVideo === 'true');

    // Parse tags if present
    if (data.tags !== undefined) {
      if (Array.isArray(data.tags)) {
        data.tags = data.tags.map(t => t.trim()).filter(Boolean);
      } else if (typeof data.tags === 'string' && data.tags.trim()) {
        data.tags = data.tags.split(',').map(t => t.trim()).filter(Boolean);
      } else {
        data.tags = [];
      }
    }

    // Regenerate slug if title changed
    if (data.title) {
      data.slug = slugify(data.title);
    }

    const doc = await Post.findByIdAndUpdate(id, data, { new: true }).lean();
    return toPlain(doc);
  } catch (e) {
    console.error('Store updatePost error:', e);
    return null;
  }
}

async function deletePost(id) {
  try {
    const res = await Post.findByIdAndDelete(id);
    if (res) await Comment.deleteMany({ postId: id });
    return !!res;
  } catch (e) {
    return false;
  }
}

async function toggleFeatured(id) {
  try {
    const post = await Post.findById(id);
    if (!post) return null;
    post.featured = !post.featured;
    await post.save();
    return toPlain(post);
  } catch (e) {
    return null;
  }
}

async function getCategories() {
  return Post.distinct('category', { status: { $ne: 'draft' } });
}

async function getSliderPosts() {
  const docs = await Post.find({ featured: true, status: { $ne: 'draft' } })
    .sort({ createdAt: -1 }).lean();
  return toPlain(docs).map(p => ({
    id:    p.id,
    image: p.image,
    title: p.title,
    link:  '/post/' + (p.slug || p.id)
  }));
}

// ── Popular posts — sorted by views descending ────────────────────────────────
async function getPopularPosts(limit = 5) {
  const docs = await Post.find({ status: { $ne: 'draft' } })
    .sort({ views: -1 })
    .limit(limit)
    .lean();
  return toPlain(docs);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST VIEW COUNTER
// ─────────────────────────────────────────────────────────────────────────────
async function incrementViews(postId) {
  try {
    const doc = await Post.findByIdAndUpdate(
      postId,
      { $inc: { views: 1 } },
      { new: true }
    ).lean();
    return toPlain(doc);
  } catch (e) {
    console.error('incrementViews error:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST LIKE / CLAP COUNTER
// ─────────────────────────────────────────────────────────────────────────────
async function incrementLikes(postId) {
  try {
    const doc = await Post.findByIdAndUpdate(
      postId,
      { $inc: { likes: 1 } },
      { new: true }
    ).lean();
    return toPlain(doc);
  } catch (e) {
    console.error('incrementLikes error:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────────────────────────────────────

async function getCommentsByPost(postId) {
  try {
    const docs = await Comment.find({ postId }).sort({ createdAt: 1 }).lean();
    return toPlain(docs);
  } catch (e) {
    return [];
  }
}

async function addComment(postId, name, email, message) {
  const dateStr = new Date().toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const doc = await Comment.create({
    postId,
    name:     name.trim(),
    email:    email.trim(),
    message:  message.trim(),
    date:     dateStr,
    approved: true
  });
  return toPlain(doc);
}

async function deleteComment(id) {
  try {
    return !!(await Comment.findByIdAndDelete(id));
  } catch (e) {
    return false;
  }
}

async function getAllComments() {
  const docs = await Comment.find().sort({ createdAt: -1 }).lean();
  return toPlain(docs);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTACT MESSAGES
// ─────────────────────────────────────────────────────────────────────────────

async function addContactMessage(name, email, subject, message) {
  const dateStr = new Date().toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const doc = await Message.create({
    name:    name.trim(),
    email:   email.trim(),
    subject: subject.trim(),
    message: message.trim(),
    date:    dateStr,
    read:    false
  });
  return toPlain(doc);
}

async function getAllMessages() {
  const docs = await Message.find().sort({ createdAt: -1 }).lean();
  return toPlain(docs);
}

async function markMessageRead(id) {
  try {
    const doc = await Message.findByIdAndUpdate(id, { read: true }, { new: true }).lean();
    return toPlain(doc);
  } catch (e) {
    return null;
  }
}

async function deleteMessage(id) {
  try {
    return !!(await Message.findByIdAndDelete(id));
  } catch (e) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIBERS
// ─────────────────────────────────────────────────────────────────────────────

async function addSubscriber(email) {
  const exists = await Subscriber.findOne({ email: email.toLowerCase() });
  if (exists) return { exists: true };
  const dateStr = new Date().toLocaleDateString('en-GB');
  const sub = await Subscriber.create({ email: email.toLowerCase(), date: dateStr });
  return { exists: false, sub: toPlain(sub) };
}

async function getAllSubscribers() {
  const docs = await Subscriber.find().sort({ createdAt: -1 }).lean();
  return toPlain(docs);
}

async function deleteSubscriber(id) {
  try {
    return !!(await Subscriber.findByIdAndDelete(id));
  } catch (e) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

async function getSettings() {
  const doc = await Settings.findOne({ key: 'site' }).lean();
  return doc
    ? Object.assign({}, DEFAULT_SETTINGS, doc.value)
    : Object.assign({}, DEFAULT_SETTINGS);
}

async function updateSettings(data) {
  const current = await getSettings();
  const merged  = Object.assign({}, current, data);
  await Settings.findOneAndUpdate(
    { key: 'site' },
    { value: merged },
    { upsert: true }
  );
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS — admin dashboard
// ─────────────────────────────────────────────────────────────────────────────

async function getStats() {
  const [
    totalPosts,
    featuredPosts,
    draftPosts,
    totalComments,
    totalMessages,
    unreadMessages,
    totalSubscribers,
    catList,
    totalViewsAgg,
    totalLikesAgg
  ] = await Promise.all([
    Post.countDocuments({ status: { $ne: 'draft' } }),
    Post.countDocuments({ featured: true }),
    Post.countDocuments({ status: 'draft' }),
    Comment.countDocuments(),
    Message.countDocuments(),
    Message.countDocuments({ read: false }),
    Subscriber.countDocuments(),
    Post.distinct('category'),
    Post.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]),
    Post.aggregate([{ $group: { _id: null, total: { $sum: '$likes' } } }]),
  ]);

  return {
    totalPosts,
    featuredPosts,
    draftPosts,
    totalComments,
    totalMessages,
    unreadMessages,
    totalSubscribers,
    categories:  catList.length,
    totalViews:  totalViewsAgg[0]  ? totalViewsAgg[0].total  : 0,
    totalLikes:  totalLikesAgg[0]  ? totalLikesAgg[0].total  : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  adminUser,
  seedIfEmpty,

  // Posts
  getAllPosts,
  getAllPostsAdmin,
  getPostById,
  getPostBySlugOrId,
  createPost,
  updatePost,
  deletePost,
  toggleFeatured,
  getCategories,
  getSliderPosts,
  getPopularPosts,
  incrementViews,
  incrementLikes,

  // Comments
  getCommentsByPost,
  addComment,
  deleteComment,
  getAllComments,

  // Messages
  addContactMessage,
  getAllMessages,
  markMessageRead,
  deleteMessage,

  // Subscribers
  addSubscriber,
  getAllSubscribers,
  deleteSubscriber,

  // Settings
  getSettings,
  updateSettings,

  // Stats
  getStats,
};

Add this
// ─────────────────────────────────────────────────────────────────────────────
// PATCH: add these routes to server/routes/admin.js
// Place them after the existing tags routes and before the Comments section.
// ─────────────────────────────────────────────────────────────────────────────

// ── Categories ────────────────────────────────────────────────────────────────

// GET /api/admin/categories  — return the managed category list
router.get('/categories', requireAdmin, async (req, res) => {
  try {
    const categories = await store.getCategories();
    res.json({ success: true, categories });
  } catch (err) {
    console.error('GET /admin/categories error:', err);
    res.status(500).json({ success: false, message: 'Failed to load categories.' });
  }
});

// POST /api/admin/categories  — add a new category
// Body: { name: "Sports" }
router.post('/categories', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: 'Category name is required.' });

    const categories = await store.addCategory(name);
    res.json({ success: true, message: `Category "${name.trim()}" added.`, categories });
  } catch (err) {
    console.error('POST /admin/categories error:', err);
    const status = err.message.includes('already exists') ? 409 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// PUT /api/admin/categories/:name  — rename a category (updates all posts too)
// Body: { newName: "Athletics" }
router.put('/categories/:name', requireAdmin, async (req, res) => {
  try {
    const oldName = decodeURIComponent(req.params.name).trim();
    const { newName } = req.body;

    if (!newName || !newName.trim())
      return res.status(400).json({ success: false, message: 'New category name is required.' });

    const categories = await store.renameCategory(oldName, newName);
    res.json({
      success: true,
      message: `Category renamed from "${oldName}" to "${newName.trim()}". All posts updated.`,
      categories
    });
  } catch (err) {
    console.error('PUT /admin/categories/:name error:', err);
    const status = err.message.includes('not found') ? 404
                 : err.message.includes('already exists') ? 409 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// DELETE /api/admin/categories/:name  — remove a category from the list
// Query param: ?force=true  → also clears the category field on affected posts
router.delete('/categories/:name', requireAdmin, async (req, res) => {
  try {
    const name  = decodeURIComponent(req.params.name).trim();
    const force = req.query.force === 'true';

    const categories = await store.deleteCategory(name, { force });
    const note = force
      ? ' Affected posts have had their category cleared.'
      : ' Existing posts keep their category value.';

    res.json({
      success: true,
      message: `Category "${name}" deleted.${note}`,
      categories
    });
  } catch (err) {
    console.error('DELETE /admin/categories/:name error:', err);
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});
with this
// server/routes/admin.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const store = require("../data/store");
const { requireAdmin } = require("../middleware/auth");

// ── Cloudinary setup ───────────────────────────────────────────────────────────
let uploadToCloud = null;

if (process.env.CLOUDINARY_CLOUD_NAME) {
  try {
    const cloudinary = require("cloudinary").v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    uploadToCloud = async (filePath, resourceType = "image") => {
      const result = await cloudinary.uploader.upload(filePath, {
        folder: "hon-leke-blog",
        resource_type: resourceType,
        transformation:
          resourceType === "image"
            ? [
                {
                  width: 1200,
                  crop: "limit",
                  quality: "auto",
                  fetch_format: "auto",
                },
              ]
            : undefined,
      });
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
      return result.secure_url;
    };
    console.log("✅ Cloudinary configured — media stored in the cloud.");
  } catch (e) {
    console.warn(
      "⚠️  Cloudinary package not found. Run: npm install cloudinary",
    );
  }
} else {
  console.log("ℹ️  No Cloudinary config — media saved to local disk.");
}

// ── Multer ─────────────────────────────────────────────────────────────────────
const imageDir = path.join(__dirname, "..", "..", "client", "public", "image");
const videoDir = path.join(__dirname, "..", "..", "client", "public", "video");

[imageDir, videoDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (
      file.fieldname === "video" ||
      file.fieldname.startsWith("block_video_")
    ) {
      cb(null, videoDir);
    } else {
      cb(null, imageDir);
    }
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname).toLowerCase());
  },
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === "video" || file.fieldname.startsWith("block_video_")) {
    cb(
      null,
      /mp4|webm|mov|avi|mkv/.test(
        path.extname(file.originalname).toLowerCase(),
      ),
    );
  } else {
    cb(
      null,
      /jpeg|jpg|png|gif|webp/.test(
        path.extname(file.originalname).toLowerCase(),
      ),
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 },
}).fields([
  { name: "images", maxCount: 10 },
  { name: "image", maxCount: 1 },
  { name: "video", maxCount: 1 },
  ...Array.from({ length: 20 }, (_, i) => ({
    name: "block_image_" + i,
    maxCount: 1,
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    name: "block_video_" + i,
    maxCount: 1,
  })),
]);

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ── Helper Functions ───────────────────────────────────────────────────────────
async function resolveImages(req, existingImage, existingImages) {
  const files = req.files || {};
  const imageFiles = files["images"] || files["image"] || [];
  const coverIdx = parseInt(req.body.coverIndex) || 0;

  if (!imageFiles.length) {
    const imagePath = req.body.imagePath;
    if (imagePath !== undefined && imagePath !== "") {
      return { coverImage: imagePath, allImages: [imagePath] };
    }
    return {
      coverImage: existingImage || "",
      allImages: existingImages || (existingImage ? [existingImage] : []),
    };
  }

  const resolvedPaths = await Promise.all(
    imageFiles.map(async (file) => {
      if (uploadToCloud) {
        try {
          return await uploadToCloud(file.path, "image");
        } catch (e) {
          console.error("Cloudinary image upload failed:", e.message);
          return "image/" + file.filename;
        }
      }
      return "image/" + file.filename;
    }),
  );

  const safeIdx = Math.min(coverIdx, resolvedPaths.length - 1);
  const coverImage = resolvedPaths[safeIdx];
  return { coverImage, allImages: resolvedPaths };
}

async function resolveVideo(req, existingVideoSrc) {
  const files = req.files || {};
  const videoFile = (files["video"] || [])[0];
  const videoType = req.body.videoType || "none";
  const videoUrl = req.body.videoUrl || "";
  const hasVideo = req.body.hasVideo === "true" || req.body.hasVideo === true;

  if (!hasVideo)
    return { hasVideo: false, videoType: "none", videoSrc: "", videoUrl: "" };

  if (videoType === "youtube" && videoUrl) {
    return { hasVideo: true, videoType: "youtube", videoSrc: "", videoUrl };
  }

  if (videoFile) {
    let src;
    if (uploadToCloud) {
      try {
        src = await uploadToCloud(videoFile.path, "video");
      } catch (e) {
        console.error("Cloudinary video upload failed:", e.message);
        src = "video/" + videoFile.filename;
      }
    } else {
      src = "video/" + videoFile.filename;
    }
    return { hasVideo: true, videoType: "upload", videoSrc: src, videoUrl: "" };
  }

  if (existingVideoSrc) {
    return {
      hasVideo: true,
      videoType: req.body.videoType || "upload",
      videoSrc: existingVideoSrc,
      videoUrl,
    };
  }

  return { hasVideo: false, videoType: "none", videoSrc: "", videoUrl: "" };
}

async function resolveBlocks(req, rawBlocks) {
  if (!rawBlocks || !rawBlocks.length) return [];
  const files = req.files || {};

  let imgIdx = 0;
  let vidIdx = 0;

  return Promise.all(
    rawBlocks.map(async (b) => {
      const block = Object.assign({}, b);
      delete block._fileKey;

      if (block.type === "image") {
        const key = "block_image_" + imgIdx++;
        const file = (files[key] || [])[0];
        if (file) {
          if (uploadToCloud) {
            try {
              block.image = await uploadToCloud(file.path, "image");
            } catch (e) {
              block.image = "image/" + file.filename;
            }
          } else {
            block.image = "image/" + file.filename;
          }
        }
        return block;
      }

      if (block.type === "video" && block.videoType === "upload") {
        const key = "block_video_" + vidIdx++;
        const file = (files[key] || [])[0];
        if (file) {
          if (uploadToCloud) {
            try {
              block.videoSrc = await uploadToCloud(file.path, "video");
            } catch (e) {
              block.videoSrc = "video/" + file.filename;
            }
          } else {
            block.videoSrc = "video/" + file.filename;
          }
        }
        return block;
      }

      if (block.type === "video" && block.videoType === "youtube") {
        return block;
      }

      return block;
    }),
  );
}

// ── Auth ───────────────────────────────────────────────────────────────────────
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  const admin = store.adminUser;
  if (username === admin.username && password === admin.password) {
    req.session.admin = true;
    req.session.adminName = admin.name;
    return res.json({
      success: true,
      message: "Login successful",
      name: admin.name,
    });
  }
  res.status(401).json({ success: false, message: "Invalid credentials." });
});

router.post("/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: "Logged out." });
});

router.get("/me", requireAdmin, (req, res) => {
  res.json({ success: true, name: req.session.adminName || "Admin" });
});

// ── Stats ──────────────────────────────────────────────────────────────────────
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, stats: await store.getStats() });
  } catch (err) {
    console.error("GET /admin/stats error:", err);
    res.status(500).json({ success: false, message: "Failed to load stats." });
  }
});

// ── Posts ──────────────────────────────────────────────────────────────────────
router.get("/posts", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, posts: await store.getAllPosts() });
  } catch (err) {
    console.error("GET /admin/posts error:", err);
    res.status(500).json({ success: false, message: "Failed to load posts." });
  }
});

// CREATE POST
router.post("/posts", requireAdmin, async (req, res) => {
  try {
    await runUpload(req, res);
    let tags = [];
    try {
      tags = JSON.parse(req.body.tags || "[]");
    } catch (e) {
      tags = [];
    }

    const { title, excerpt, content, category, date, featured } = req.body;
    if (!title || !excerpt || !category)
      return res.status(400).json({
        success: false,
        message: "Title, excerpt and category are required.",
      });

    const { coverImage, allImages } = await resolveImages(req, "", []);

    let rawBlocks = [];
    try {
      rawBlocks = JSON.parse(req.body.blocks || "[]");
    } catch (e) {}
    const resolvedBlocks = await resolveBlocks(req, rawBlocks);

    const videoBlock = resolvedBlocks.find((b) => b.type === "video");
    const videoData = videoBlock
      ? {
          hasVideo: true,
          videoType: videoBlock.videoType,
          videoSrc: videoBlock.videoSrc || "",
          videoUrl: videoBlock.videoUrl || "",
        }
      : await resolveVideo(req, "");

    const post = await store.createPost({
      title,
      excerpt,
      content: content || "",
      category,
      date,
      featured: featured === "true" || featured === true,
      image: coverImage,
      images: allImages,
      blocks: resolvedBlocks, 
      tags,
      ...videoData,
    });

    res.json({
      success: true,
      message: "Post created successfully!",
      post,
      postId: post.id,
    });
  } catch (err) {
    console.error("POST /admin/posts error:", err);
    res.status(500).json({
      success: false,
      message: "Server error creating post: " + err.message,
    });
  }
});

// UPDATE POST
router.put("/posts/:id", requireAdmin, async (req, res) => {
  try {
    await runUpload(req, res);
    let tags = [];
    try {
      tags = JSON.parse(req.body.tags || "[]");
    } catch (e) {
      tags = [];
    }

    const id = req.params.id;
    const existing = await store.getPostById(id);
    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "Post not found." });

    const { title, excerpt, content, category, date, featured } = req.body;

    const { coverImage, allImages } = await resolveImages(
      req,
      existing.image,
      existing.images,
    );

    let rawBlocks = [];
    try {
      rawBlocks = JSON.parse(req.body.blocks || "[]");
    } catch (e) {}
    const resolvedBlocks = await resolveBlocks(req, rawBlocks);

    const videoBlock = resolvedBlocks.find((b) => b.type === "video");
    const videoData = videoBlock
      ? {
          hasVideo: true,
          videoType: videoBlock.videoType,
          videoSrc: videoBlock.videoSrc || "",
          videoUrl: videoBlock.videoUrl || "",
        }
      : await resolveVideo(req, existing.videoSrc);

    const post = await store.updatePost(id, {
      title,
      excerpt,
      content: content || "",
      category,
      date,
      featured: featured === "true" || featured === true,
      image: coverImage,
      images: allImages,
      blocks: resolvedBlocks, 
      tags,
      ...videoData,
    });

    res.json({ success: true, message: "Post updated successfully!", post });
  } catch (err) {
    console.error("PUT /admin/posts/:id error:", err);
    res.status(500).json({
      success: false,
      message: "Server error updating post: " + err.message,
    });
  }
});

// DELETE POST
router.delete("/posts/:id", requireAdmin, async (req, res) => {
  try {
    const ok = await store.deletePost(req.params.id);
    if (!ok)
      return res
        .status(404)
        .json({ success: false, message: "Post not found." });
    res.json({ success: true, message: "Post deleted." });
  } catch (err) {
    console.error("DELETE /admin/posts/:id error:", err);
    res.status(500).json({ success: false, message: "Failed to delete post." });
  }
});

// TOGGLE FEATURED
router.patch("/posts/:id/featured", requireAdmin, async (req, res) => {
  try {
    const post = await store.toggleFeatured(req.params.id);
    if (!post)
      return res
        .status(404)
        .json({ success: false, message: "Post not found." });
    res.json({
      success: true,
      message: post.featured ? "Added to slider." : "Removed from slider.",
      featured: post.featured,
    });
  } catch (err) {
    console.error("PATCH /admin/posts/:id/featured error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to toggle featured." });
  }
});

// DELETE TAG from all posts
router.delete("/tags/:tag", requireAdmin, async (req, res) => {
  try {
    const tag = decodeURIComponent(req.params.tag).trim();
    if (!tag)
      return res
        .status(400)
        .json({ success: false, message: "Tag is required." });

    const result = await require("../models/post").updateMany(
      { tags: tag },
      { $pull: { tags: tag } },
    );

    res.json({
      success: true,
      updatedPosts: result.modifiedCount,
      message: `Tag "${tag}" removed from ${result.modifiedCount} post(s).`,
    });
  } catch (err) {
    console.error("DELETE /api/admin/tags error:", err);
    res.status(500).json({ success: false, message: "Failed to delete tag." });
  }
});

// ── Comments ───────────────────────────────────────────────────────────────────
router.get("/comments", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, comments: await store.getAllComments() });
  } catch (err) {
    console.error("GET /admin/comments error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load comments." });
  }
});

router.delete("/comments/:id", requireAdmin, async (req, res) => {
  try {
    const ok = await store.deleteComment(req.params.id);
    if (!ok)
      return res
        .status(404)
        .json({ success: false, message: "Comment not found." });
    res.json({ success: true, message: "Comment deleted." });
  } catch (err) {
    console.error("DELETE /admin/comments/:id error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete comment." });
  }
});

router.patch("/comments/:id/reply", requireAdmin, async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply || !reply.trim())
      return res
        .status(400)
        .json({ success: false, message: "Reply text is required." });

    const dateStr = new Date().toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const Comment = require("../models/Comment");
    const doc = await Comment.findByIdAndUpdate(
      req.params.id,
      { reply: reply.trim(), repliedAt: dateStr, repliedByAdmin: true },
      { new: true },
    ).lean();

    if (!doc)
      return res
        .status(404)
        .json({ success: false, message: "Comment not found." });

    const plain = JSON.parse(JSON.stringify(doc));
    plain.id = doc._id.toString();

    res.json({ success: true, message: "Reply saved.", comment: plain });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/comments/:id/reply/delete", requireAdmin, async (req, res) => {
  try {
    const Comment = require("../models/Comment");
    const doc = await Comment.findByIdAndUpdate(
      req.params.id,
      { reply: "", repliedAt: "", repliedByAdmin: false },
      { new: true },
    ).lean();

    if (!doc)
      return res
        .status(404)
        .json({ success: false, message: "Comment not found." });

    res.json({ success: true, message: "Reply removed." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Messages ───────────────────────────────────────────────────────────────────
router.get("/messages", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, messages: await store.getAllMessages() });
  } catch (err) {
    console.error("GET /admin/messages error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load messages." });
  }
});

router.patch("/messages/:id/read", requireAdmin, async (req, res) => {
  try {
    const msg = await store.markMessageRead(req.params.id);
    if (!msg)
      return res
        .status(404)
        .json({ success: false, message: "Message not found." });
    res.json({ success: true, message: "Marked as read." });
  } catch (err) {
    console.error("PATCH /admin/messages/:id/read error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to mark message as read." });
  }
});

router.delete("/messages/:id", requireAdmin, async (req, res) => {
  try {
    const ok = await store.deleteMessage(req.params.id);
    if (!ok)
      return res
        .status(404)
        .json({ success: false, message: "Message not found." });
    res.json({ success: true, message: "Message deleted." });
  } catch (err) {
    console.error("DELETE /admin/messages/:id error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete message." });
  }
});

// ── Subscribers ────────────────────────────────────────────────────────────────
router.get("/subscribers", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, subscribers: await store.getAllSubscribers() });
  } catch (err) {
    console.error("GET /admin/subscribers error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load subscribers." });
  }
});

router.delete("/subscribers/:id", requireAdmin, async (req, res) => {
  try {
    const ok = await store.deleteSubscriber(req.params.id);
    if (!ok)
      return res
        .status(404)
        .json({ success: false, message: "Subscriber not found." });
    res.json({ success: true, message: "Subscriber removed." });
  } catch (err) {
    console.error("DELETE /admin/subscribers/:id error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to remove subscriber." });
  }
});

// ── Settings ───────────────────────────────────────────────────────────────────
router.get("/settings", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, settings: await store.getSettings() });
  } catch (err) {
    console.error("GET /admin/settings error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load settings." });
  }
});

router.put("/settings", requireAdmin, async (req, res) => {
  try {
    const settings = await store.updateSettings(req.body);
    res.json({ success: true, message: "Settings updated.", settings });
  } catch (err) {
    console.error("PUT /admin/settings error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update settings." });
  }
});

// ── About Page ─────────────────────────────────────────────────────────────────
const aboutUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
}).fields([
  { name: "lekeImage", maxCount: 1 },
  { name: "spouseImage", maxCount: 1 },
  ...Array.from({ length: 20 }, (_, i) => ({
    name: "teamImage_" + i,
    maxCount: 1,
  })),
]);

function runAboutUpload(req, res) {
  return new Promise((resolve, reject) => {
    aboutUpload(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

router.post("/about", requireAdmin, async (req, res) => {
  try {
    await runAboutUpload(req, res);
    const files = req.files || {};
    const aboutData = JSON.parse(req.body.aboutData || "{}");

    if (files["lekeImage"] && files["lekeImage"][0]) {
      const f = files["lekeImage"][0];
      aboutData.lekeImage = uploadToCloud
        ? await uploadToCloud(f.path, "image").catch(
            () => "image/" + f.filename,
          )
        : "image/" + f.filename;
    }

    if (files["spouseImage"] && files["spouseImage"][0]) {
      const f = files["spouseImage"][0];
      aboutData.spouseImage = uploadToCloud
        ? await uploadToCloud(f.path, "image").catch(
            () => "image/" + f.filename,
          )
        : "image/" + f.filename;
    }

    if (aboutData.team) {
      for (let i = 0; i < aboutData.team.length; i++) {
        const key = "teamImage_" + i;
        if (files[key] && files[key][0]) {
          const f = files[key][0];
          aboutData.team[i].image = uploadToCloud
            ? await uploadToCloud(f.path, "image").catch(
                () => "image/" + f.filename,
              )
            : "image/" + f.filename;
        }
      }
    }

    const current = await store.getSettings();
    const settings = await store.updateSettings({
      ...current,
      about: aboutData,
    });
    res.json({ success: true, message: "About page updated.", settings });
  } catch (err) {
    console.error("POST /admin/about error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to save about page: " + err.message,
    });
  }
});

module.exports = router;

give updated codes