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
// Seed posts
// ─────────────────────────────────────────────────────────────────────────────
const SEED_POSTS = [];

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
// Slug helper & toPlain
// ─────────────────────────────────────────────────────────────────────────────
function slugify(text) {
  return String(text || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

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

async function getPostBySlugOrId(slugOrId) {
  try {
    let doc = await Post.findOne({ slug: slugOrId }).lean();
    if (doc) return toPlain(doc);
    doc = await Post.findById(slugOrId).lean();
    return toPlain(doc);
  } catch (e) {
    return null;
  }
}

async function createPost(data) {
  const dateStr = data.date ||
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  let tags = [];
  if (Array.isArray(data.tags)) {
    tags = data.tags.map(t => t.trim()).filter(Boolean);
  } else if (typeof data.tags === 'string' && data.tags.trim()) {
    tags = data.tags.split(',').map(t => t.trim()).filter(Boolean);
  }

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

    if (data.tags !== undefined) {
      if (Array.isArray(data.tags)) {
        data.tags = data.tags.map(t => t.trim()).filter(Boolean);
      } else if (typeof data.tags === 'string' && data.tags.trim()) {
        data.tags = data.tags.split(',').map(t => t.trim()).filter(Boolean);
      } else {
        data.tags = [];
      }
    }

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

async function getPopularPosts(limit = 5) {
  const docs = await Post.find({ status: { $ne: 'draft' } })
    .sort({ views: -1 })
    .limit(limit)
    .lean();
  return toPlain(docs);
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW CATEGORY MANAGEMENT METHODS
// ─────────────────────────────────────────────────────────────────────────────

async function getCategories() {
  const settings = await getSettings();
  if (settings.categories && settings.categories.length) {
    return settings.categories;
  }
  // first-run fallback: seed from existing posts
  const posts = await getAllPosts();
  const derived = [...new Set(posts.map(p => p.category).filter(Boolean))].sort();
  return derived;
}

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

  await updateSettings({ ...current, categories: cats }); 
  return cats;
}

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
  const Post = require('../models/post'); // NOTE: lowercase 'post' matches your existing requires
  await Post.updateMany(
    { category: { $regex: new RegExp(`^${escapeRegex(old)}$`, 'i') } },
    { $set: { category: next } }
  );

  await updateSettings({ ...current, categories: cats });
  return cats;
}

async function deleteCategory(name, { force = false } = {}) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Category name is required.');

  const current = await getSettings();
  const cats    = current.categories ? [...current.categories] : await getCategories();

  const idx = cats.findIndex(c => c.toLowerCase() === trimmed.toLowerCase());
  if (idx === -1) throw new Error(`Category "${trimmed}" not found.`);

  cats.splice(idx, 1);

  if (force) {
    const Post = require('../models/post'); // NOTE: lowercase 'post'
    await Post.updateMany(
      { category: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') } },
      { $set: { category: '' } }
    );
  }

  await updateSettings({ ...current, categories: cats });
  return cats;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNTERS
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
  
  // Categories (Updated)
  getCategories,
  addCategory,
  renameCategory,
  deleteCategory,

  // Slider & Popular
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