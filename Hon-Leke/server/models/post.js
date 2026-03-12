const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  category: { type: String, required: true },
  date:     { type: String },
  image:    { type: String, default: '' },
  images:   { type: [String], default: [] },
  excerpt:  { type: String, required: true },
  content:  { type: String, required: true },
  featured: { type: Boolean, default: false },
  hasVideo: { type: Boolean, default: false },
  videoSrc: { type: String, default: '' },
  videoType:{ type: String, default: 'none' },
  videoUrl: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Post', postSchema);