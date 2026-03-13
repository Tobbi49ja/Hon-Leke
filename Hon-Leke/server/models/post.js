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

  // ── Legacy flat fields (kept for backwards compatibility) ──
  content:  { type: String, default: '' },
  image:    { type: String, default: '' },
  images:   { type: [String], default: [] },
  hasVideo: { type: Boolean, default: false },
  videoSrc: { type: String, default: '' },
  videoType:{ type: String, default: 'none' },
  videoUrl: { type: String, default: '' },

  // ── New: block-based body ──────────────────────────────────
  // Each element is { type, text?, image?, caption?, videoType?, videoUrl?, videoSrc? }
  blocks:   { type: [blockSchema], default: [] },

  featured: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Post', postSchema);