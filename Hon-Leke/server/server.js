// server/server.js
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path    = require('path');

const { apiLimiter, contactLimiter, requireAdmin } = require('./middleware/index');
const postsRouter   = require('./routes/posts');
const contactRouter = require('./routes/contact');
const adminRouter   = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

//Middleware 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lekeabejide-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

//Static Files
app.use(express.static(path.join(__dirname, '..', 'client', 'public')));
app.use('/admin/assets', express.static(path.join(__dirname, '..', 'admin', 'public')));

// API Routes
app.use('/api', apiLimiter);
app.use('/api/posts', postsRouter);
app.use('/api/contact', contactLimiter, contactRouter);
app.use('/api/subscribe', (req, res, next) => {
  req.url = '/subscribe';
  contactRouter(req, res, next);
});
app.use('/api/admin', adminRouter);

//Client Pages
const clientPages = path.join(__dirname, '..', 'client', 'pages');

app.get('/', (req, res) => res.sendFile(path.join(clientPages, 'home', 'index.html')));
app.get('/about', (req, res) => res.sendFile(path.join(clientPages, 'about', 'index.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(clientPages, 'contact', 'index.html')));
app.get('/post/:id', (req, res) => res.sendFile(path.join(clientPages, 'post', 'index.html')));

//Admin Pages 
const adminPages = path.join(__dirname, '..', 'admin', 'pages');

app.get('/admin', (req, res) => res.redirect('/admin/login'));
app.get('/admin/login', (req, res) => res.sendFile(path.join(adminPages, 'login.html')));
app.get('/admin/dashboard', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'dashboard.html')));
app.get('/admin/posts', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'posts.html')));
app.get('/admin/posts/new', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'post-form.html')));
app.get('/admin/posts/edit/:id', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'post-form.html')));
app.get('/admin/comments', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'comments.html')));
app.get('/admin/messages', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'messages.html')));
app.get('/admin/subscribers', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'subscribers.html')));
app.get('/admin/settings', requireAdmin, (req, res) => res.sendFile(path.join(adminPages, 'settings.html')));

// 404 page
app.use((req, res) => {
  res.status(404).sendFile(path.join(clientPages, '404', 'index.html'));
});

//Start
app.listen(PORT, () => {
  console.log(`\n✅  Hon. Leke Abejide Blog`);
  console.log(`🌐  Site:  http://localhost:${PORT}`);
  console.log(`🔐  Admin: http://localhost:${PORT}/admin`);
});
