const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  postId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  name:     { type: String, required: true },
  email:    { type: String, required: true },
  message:  { type: String, required: true },
  date:     { type: String },
  approved: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Comment', commentSchema);