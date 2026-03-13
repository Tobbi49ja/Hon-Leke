// server/models/Comment.js
const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  postId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  name:     { type: String, required: true },
  email:    { type: String, required: true },
  message:  { type: String, required: true },
  date:     { type: String },
  approved: { type: Boolean, default: true },

  // ── Admin reply ──────────────────────────────────────────────
  reply:        { type: String, default: '' },      // reply text
  repliedAt:    { type: String, default: '' },      // human-readable date
  repliedByAdmin: { type: Boolean, default: false } // flag so UI knows
}, { timestamps: true });

module.exports = mongoose.model('Comment', commentSchema);