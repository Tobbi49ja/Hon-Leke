const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actor: { type: String, required: true },
  actorType: { type: String, default: 'admin' },
  action: { type: String, required: true, index: true },
  resourceType: { type: String, required: true, index: true },
  resourceId: { type: String },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String },
  userAgent: { type: String },
  success: { type: Boolean, default: true },
  statusCode: { type: Number },
  route: { type: String },
  method: { type: String, required: true },
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
