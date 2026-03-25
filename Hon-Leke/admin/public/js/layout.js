// admin/public/js/layout.js — Shared admin utilities

const adminAPI = {
  async get(url) {
    try {
      const res = await fetch(url);
      if (res.status === 401) { window.location.href = '/admin/login'; return null; }
      const data = await res.json();
      if (!res.ok) {
        console.error('API error [GET ' + url + ']:', data.message || res.status);
        return data; 
      }
      return data;
    } catch(err) {
      console.error('Network error [GET ' + url + ']:', err.message);
      return null;
    }
  },
  async post(url, data) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.status === 401) { window.location.href = '/admin/login'; return null; }
      return res.json();
    } catch(err) {
      console.error('Network error [POST ' + url + ']:', err.message);
      return null;
    }
  },
  async put(url, data) {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.status === 401) { window.location.href = '/admin/login'; return null; }
      return res.json();
    } catch(err) {
      console.error('Network error [PUT ' + url + ']:', err.message);
      return null;
    }
  },
  async patch(url, data) {
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
      });
      if (res.status === 401) { window.location.href = '/admin/login'; return null; }
      return res.json();
    } catch(err) {
      console.error('Network error [PATCH ' + url + ']:', err.message);
      return null;
    }
  },
  async delete(url) {
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (res.status === 401) { window.location.href = '/admin/login'; return null; }
      return res.json();
    } catch(err) {
      console.error('Network error [DELETE ' + url + ']:', err.message);
      return null;
    }
  }
};

function initAdminLayout(pageTitle, activeNav) {
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = pageTitle;
  document.title = pageTitle + ' — Admin';

  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    link.classList.toggle('active', link.dataset.page === activeNav);
  });

  adminAPI.get('/api/admin/me').then(data => {
    if (!data) return;
    const nameEl   = document.getElementById('admin-name');
    const avatarEl = document.getElementById('admin-avatar');
    if (nameEl)   nameEl.textContent   = data.name;
    if (avatarEl) avatarEl.textContent = (data.name || 'A')[0].toUpperCase();
  }).catch(() => {});

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async e => {
      e.preventDefault();
      await adminAPI.post('/api/admin/logout');
      window.location.href = '/admin/login';
    });
  }
}

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.style.cssText = 'padding:12px 18px;border-radius:8px;font-size:0.88rem;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15);color:white;max-width:320px;background:'
    + (type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#1a3c5e')
    + ';animation:fadeInToast 0.3s ease;';
  toast.innerHTML = '<i class="bi bi-' + (type === 'success' ? 'check-circle' : 'exclamation-circle') + '"></i> ' + message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function confirmDelete(message, callback) {
  if (window.confirm(message)) callback();
}

const style = document.createElement('style');
style.textContent = '@keyframes fadeInToast{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
document.head.appendChild(style);