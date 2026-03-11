# Hon. Leke Abejide — Official Blog

## Folder Structure

```
Hon-Leke/
├── admin/
│   ├── pages/
│   │   ├── login.html
│   │   ├── dashboard.html
│   │   ├── posts.html
│   │   ├── post-form.html
│   │   ├── comments.html
│   │   ├── messages.html
│   │   ├── subscribers.html
│   │   └── settings.html
│   └── public/
│       ├── css/admin.css
│       └── js/layout.js
│
├── client/
│   ├── pages/
│   │   ├── 404/index.html
│   │   ├── about/index.html
│   │   ├── contact/index.html
│   │   ├── home/index.html
│   │   └── post/index.html
│   └── public/
│       ├── css/style.css
│       ├── js/app.js
│       └── image/   ← place all images here
│
├── server/
│   ├── data/store.js
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── rateLimiter.js
│   │   └── index.js
│   ├── routes/
│   │   ├── admin.js
│   │   ├── contact.js
│   │   └── posts.js
│   └── server.js
│
├── .env.example
├── package.json
└── README.md
```

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env
# Edit .env with your settings

# 3. Place your images in client/public/image/

# 4. Start the server
npm start
# or for development with auto-reload:
npm run dev
```

## Access

- **Site**: http://localhost:3000
- **Admin**: http://localhost:3000/admin/login
  - Username: `admin`
  - Password: `admin123`

## Admin Features

- **Dashboard** — Stats overview + quick post management
- **Blog Posts** — View, create, edit, delete all posts. Toggle featured/slider posts
- **New Post** — Full post editor with image upload, video support, category, featured toggle
- **Comments** — View and delete comments on any post
- **Messages** — View, mark read, delete contact form submissions
- **Subscribers** — View newsletter subscribers, export as CSV
- **Settings** — Edit site title, social links, contact email, footer text

## API Endpoints (Public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/posts | All posts (supports ?category= ?search=) |
| GET | /api/posts/slider | Featured posts for homepage slider |
| GET | /api/posts/categories | All categories |
| GET | /api/posts/:id | Single post |
| GET | /api/posts/:id/comments | Post comments |
| POST | /api/posts/:id/comments | Submit comment |
| POST | /api/contact | Contact form |
| POST | /api/subscribe | Newsletter subscribe |

## Production Notes

- Replace in-memory store in `server/data/store.js` with MongoDB or SQLite for persistence
- Change admin password in `server/data/store.js` → `adminUser.password`
- Set a strong `SESSION_SECRET` in `.env`
- Configure SMTP settings in `.env` for email delivery
