// server/data/store.js
// MongoDB-backed data store
require('dotenv').config();

const Post       = require('../models/Post');
const Comment    = require('../models/Comment');
const Subscriber = require('../models/Subscriber');
const Message    = require('../models/Message');
const Settings   = require('../models/Settings');

// Admin credentials
const adminUser = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'changeme',
  name:     process.env.ADMIN_NAME     || 'Site Administrator'
};

// Default site settings
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

const SEED_POSTS = [
  // ... (Keep your existing SEED_POSTS array here)
];

// Seed on first boot
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

/**
 * Robustly convert Mongoose docs to plain objects with string IDs
 */
function toPlain(doc) {
  if (!doc) return null;
  
  // Handle arrays
  if (Array.isArray(doc)) return doc.map(toPlain);

  // Convert Mongoose document to object if necessary
  let obj = doc.toObject ? doc.toObject() : doc;

  // Flatten the object to remove MongoDB-specific types (Dates, ObjectIds)
  // and ensure 'id' is a simple string.
  const plain = JSON.parse(JSON.stringify(obj));
  
  if (obj._id) {
    plain.id = obj._id.toString();
  }
  
  return plain;
}

// Posts
async function getAllPosts() {
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

async function createPost(data) {
  const dateStr = data.date ||
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  
  const doc = await Post.create({
    ...data,
    date: dateStr,
    featured: data.featured === true || data.featured === 'true',
    hasVideo: data.hasVideo === true || data.hasVideo === 'true',
    images: data.images || (data.image ? [data.image] : [])
  });
  return toPlain(doc);
}

async function updatePost(id, data) {
  try {
    // Explicitly handle booleans from form-data
    if (data.featured !== undefined) data.featured = (data.featured === true || data.featured === 'true');
    if (data.hasVideo !== undefined) data.hasVideo = (data.hasVideo === true || data.hasVideo === 'true');

    const doc = await Post.findByIdAndUpdate(id, data, { new: true }).lean();
    return toPlain(doc);
  } catch (e) {
    console.error("Store Update Error:", e);
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
  return Post.distinct('category');
}

async function getSliderPosts() {
  const docs = await Post.find({ featured: true }).sort({ createdAt: -1 }).lean();
  return toPlain(docs).map(p => ({
    id: p.id,
    image: p.image,
    title: p.title,
    link: '/post/' + p.id
  }));
}

// Comments
async function getCommentsByPost(postId) {
  try {
    const docs = await Comment.find({ postId }).sort({ createdAt: 1 }).lean();
    return toPlain(docs);
  } catch (e) {
    return [];
  }
}

async function addComment(postId, name, email, message) {
  const dateStr = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const doc = await Comment.create({
    postId,
    name: name.trim(),
    email: email.trim(),
    message: message.trim(),
    date: dateStr,
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

// Contact messages
async function addContactMessage(name, email, subject, message) {
  const dateStr = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const doc = await Message.create({
    name: name.trim(), email: email.trim(),
    subject: subject.trim(), message: message.trim(),
    date: dateStr, read: false
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

// Subscribers
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

// Settings (Remains as is since it doesn't use ObjectIds for identification)
async function getSettings() {
  const doc = await Settings.findOne({ key: 'site' }).lean();
  return doc ? Object.assign({}, DEFAULT_SETTINGS, doc.value) : Object.assign({}, DEFAULT_SETTINGS);
}

async function updateSettings(data) {
  const current = await getSettings();
  const merged  = Object.assign({}, current, data);
  await Settings.findOneAndUpdate({ key: 'site' }, { value: merged }, { upsert: true });
  return merged;
}

// Stats
async function getStats() {
  const [totalPosts, featuredPosts, totalComments, totalMessages, unreadMessages, totalSubscribers, catList] =
    await Promise.all([
      Post.countDocuments(),
      Post.countDocuments({ featured: true }),
      Comment.countDocuments(),
      Message.countDocuments(),
      Message.countDocuments({ read: false }),
      Subscriber.countDocuments(),
      Post.distinct('category')
    ]);
  return { totalPosts, featuredPosts, totalComments, totalMessages, unreadMessages, totalSubscribers, categories: catList.length };
}

module.exports = {
  adminUser,
  seedIfEmpty,
  getAllPosts, getPostById, createPost, updatePost, deletePost, toggleFeatured,
  getCategories, getSliderPosts,
  getCommentsByPost, addComment, deleteComment, getAllComments,
  addContactMessage, getAllMessages, markMessageRead, deleteMessage,
  addSubscriber, getAllSubscribers, deleteSubscriber,
  getSettings, updateSettings,
  getStats
};