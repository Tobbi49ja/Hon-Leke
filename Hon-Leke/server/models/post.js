// server/models/Post.js
const mongoose = require('mongoose');

// A "block" is one unit of content — either text or media
const blockSchema = new mongoose.Schema({
  type:      { type: String, enum: ['text', 'image', 'video'], required: true },
  // text block
  text:      { type: String, default: '' },
  // image block
  image:     { type: String, default: '' },
  caption:   { type: String, default: '' },
  // video block
  videoType: { type: String, default: 'none' }, // 'youtube' | 'upload'
  videoUrl:  { type: String, default: '' },      // youtube URL
  videoSrc:  { type: String, default: '' },      // uploaded file path
}, { _id: false });

const postSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  category: { type: String, required: true },
  date:     { type: String },
  excerpt:  { type: String, required: true },

  // ── Slug for clean URLs (/post/my-post-title) ─────────────
  slug:     { type: String, default: '', index: true },

  // ── Legacy flat fields (kept for backwards compatibility) ──
  content:  { type: String, default: '' },
  image:    { type: String, default: '' },
  images:   { type: [String], default: [] },
  hasVideo: { type: Boolean, default: false },
  videoSrc: { type: String, default: '' },
  videoType:{ type: String, default: 'none' },
  videoUrl: { type: String, default: '' },

  // ── Block-based body ──────────────────────────────────────
  blocks:   { type: [blockSchema], default: [] },

  // ── Taxonomy ──────────────────────────────────────────────
  tags:     { type: [String], default: [] },

  // ── Engagement counters ───────────────────────────────────
  views:    { type: Number, default: 0 },
  likes:    { type: Number, default: 0 },

  // ── Status ────────────────────────────────────────────────
  featured: { type: Boolean, default: false },
  status:   { type: String, enum: ['published', 'draft'], default: 'published' },

}, { timestamps: true });

// ── Auto-generate slug from title before saving ───────────────
postSchema.pre('save', async function () {
  if (this.isModified('title') || !this.slug) {
    this.slug = slugify(this.title);
  }
});

// Utility: convert title → url-safe slug
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')   // remove special chars
    .replace(/\s+/g, '-')            // spaces → hyphens
    .replace(/-+/g, '-')             // collapse multiple hyphens
    .slice(0, 80);                   // max 80 chars
}

module.exports = mongoose.model('Post', postSchema);