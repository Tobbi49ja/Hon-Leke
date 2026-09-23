const AuditLog = require('../models/AuditLog');

const sensitiveKeys = new Set([
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'session',
]);

const summarizedKeys = new Set([
  'content',
  'message',
  'reply',
  'text',
  'aboutData',
  'blocks',
  'images',
  'videoSrc',
  'videoUrl',
]);

function summarizeValue(value, key = '', depth = 0) {
  const normalizedKey = key.toLowerCase();

  if (sensitiveKeys.has(normalizedKey) || normalizedKey.includes('password')) {
    return '[redacted]';
  }

  if (value === null || value === undefined) return null;
  if (depth > 3) return '[omitted]';

  if (summarizedKeys.has(normalizedKey)) {
    if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
    if (typeof value === 'string') return `${value.length} character${value.length === 1 ? '' : 's'}`;
    if (typeof value === 'object') return `${Object.keys(value).length} fields`;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => summarizeValue(item, key, depth + 1));
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      result[nestedKey] = summarizeValue(nestedValue, nestedKey, depth + 1);
    }
    return result;
  }

  if (typeof value === 'string') return value.slice(0, 160);
  return value;
}

function inferAuditTarget(req) {
  const parts = req.path.split('/').filter(Boolean);
  const resource = parts[0] || 'admin';
  const id = parts[1] && parts[1] !== 'reorder' ? parts[1] : null;
  const method = req.method.toLowerCase();

  if (resource === 'categories') {
    return {
      action: method === 'post' ? 'create' : method === 'put' ? 'update' : 'delete',
      resourceType: 'category',
      resourceId: method === 'put' || method === 'delete' ? id : null,
    };
  }

  if (resource === 'posts') {
    if (parts[1] === 'reorder') {
      return { action: 'reorder', resourceType: 'post', resourceId: null };
    }
    if (parts[2] === 'featured') {
      return { action: 'toggle_featured', resourceType: 'post', resourceId: id };
    }
    return {
      action: method === 'post' ? 'create' : method === 'put' ? 'update' : 'delete',
      resourceType: 'post',
      resourceId: method === 'put' || method === 'delete' ? id : null,
    };
  }

  if (resource === 'tags') {
    return { action: 'delete', resourceType: 'tag', resourceId: id };
  }

  if (resource === 'comments') {
    if (parts[2] === 'reply' && parts[3] === 'delete') {
      return { action: 'delete_reply', resourceType: 'comment', resourceId: id };
    }
    if (parts[2] === 'reply') {
      return { action: 'reply', resourceType: 'comment', resourceId: id };
    }
    return { action: 'delete', resourceType: 'comment', resourceId: id };
  }

  if (resource === 'messages') {
    return {
      action: parts[2] === 'read' ? 'mark_read' : 'delete',
      resourceType: 'message',
      resourceId: id,
    };
  }

  if (resource === 'subscribers') {
    return { action: 'delete', resourceType: 'subscriber', resourceId: id };
  }

  if (resource === 'settings') {
    return { action: 'update', resourceType: 'setting', resourceId: 'site' };
  }

  if (resource === 'about') {
    return { action: 'update', resourceType: 'about_page', resourceId: 'site' };
  }

  return {
    action: `${method}_${resource}`,
    resourceType: resource,
    resourceId: id,
  };
}

async function recordAudit(
  req,
  action,
  resourceType,
  resourceId = null,
  details = {},
  success = true,
  statusCode = 200,
) {
  const actor =
    req.session?.adminName ||
    req.session?.adminUsername ||
    req.body?.username ||
    'Unknown';

  const entry = {
    actor,
    actorType: 'admin',
    action,
    resourceType,
    resourceId: resourceId ? String(resourceId) : null,
    details: summarizeValue(details),
    ipAddress: req.ip || null,
    userAgent: req.get('user-agent') || null,
    success,
    statusCode,
    route: (req.originalUrl || req.url || '').split('?')[0],
    method: req.method,
  };

  try {
    await AuditLog.create(entry);
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

function auditMutations(req, res, next) {
  if (req.method === 'GET' || req.path === '/login' || req.path === '/logout') {
    return next();
  }

  const originalJson = res.json.bind(res);
  let logged = false;

  res.json = (payload) => {
    if (!logged) {
      logged = true;
      const target = inferAuditTarget(req);
      const success =
        res.statusCode >= 200 &&
        res.statusCode < 300 &&
        (!payload || payload.success !== false);

      recordAudit(
        req,
        target.action,
        target.resourceType,
        target.resourceId,
        req.body || {},
        success,
        res.statusCode,
      ).catch(() => {});
    }

    return originalJson(payload);
  };

  next();
}

module.exports = { auditMutations, recordAudit };
