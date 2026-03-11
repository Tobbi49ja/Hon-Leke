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
