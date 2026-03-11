// server/data/store.js
// Central in-memory data store — replace with MongoDB/SQLite for production
require('dotenv').config();

let posts = [
  {
    id: 1,
    title: "The Chairman House Committee on Customs and Excise, Hon. Leke Abejide, Participates in Youth Townhall Meeting",
    category: "News",
    date: "July 31st '24",
    image: "image/MEETING WITH YOUTH  (1).jpg",
    excerpt: "The Chairman House Committee on Customs and Excise, Hon. Leke Abejide, Participates in Youth Townhall Meeting.",
    content: "Hon. Leke Abejide, Chairman of the House Committee on Customs and Excise, participated in a Youth Townhall Meeting representing the interests of young constituents across Yagba Federal Constituency.",
    featured: true
  },
  {
    id: 2,
    title: "Rep. Leke Abejide of ADC Dissociates Self From National Chairman's Statement, Says Nigeria Needs Patience Not Protest",
    category: "News",
    date: "July 29th '24",
    image: "image/patient not protest (6).jpg",
    excerpt: "Rep. Leke Abejide of ADC dissociates self from National Chairman's statement, says Nigeria needs patience not protest.",
    content: "Rep. Leke Abejide of ADC has dissociated himself from the National Chairman's statement, saying Nigeria needs patience, not protest, at this critical time.",
    featured: false
  },
  {
    id: 3,
    title: "Hon. Leke Abejide Celebrates Barr. Bamidele Suru, Describes Him As A Man of Repute",
    category: "Celebration",
    date: "July 28th '24",
    image: "image/BIRTHDAY  BARRIS.jpg",
    excerpt: "Hon. Leke Abejide celebrates Barr. Bamidele Suru, describes him as a man of repute who has achieved great success.",
    content: `Hon. Leke Abejide the member representing Yagba Federal Constituency celebrates Barr. Bamidele Suru on the occasion of his birthday celebration, he described him as a man of repute who has achieved great success in contributing to human development.

Hon. Abejide in his birthday message said Barr. Bamidele Suru is a politician of repute with an exquisite and quintessential personality who has over the years, demonstrated his love for grassroots development in no small measure.

"Congratulations to my dear friend and brother, Barr. Bamidele Suru a quintessential gentle and brilliant lawyer. He has proven over the years to be a dependable hand in the business of governance and works assiduously for the development of the people."`,
    featured: true
  },
  {
    id: 4,
    title: "Hon. Leke Abejide Takes Immediate Action on Gully Erosion at Ponyan Community",
    category: "Community",
    date: "July 25th '24",
    image: "image/erosion  (1).jpg",
    excerpt: "Hon. Leke Abejide takes immediate action on gully erosion at Ponyan Community.",
    content: "Hon. Leke Abejide, representing Yagba Federal Constituency, has taken immediate action to address the devastating gully erosion affecting the road at Ponyan Community, demonstrating his commitment to infrastructure development.",
    featured: false
  },
  {
    id: 5,
    title: "Hon. Leke Abejide: Inspection and Oversight Visit to Nigerian Customs Service Headquarters",
    category: "Legislative",
    date: "July 18th '24",
    image: "image/Inspector 1.jpg",
    excerpt: "Hon. Leke Abejide conducts inspection and oversight visit to Nigerian Customs Service Headquarters.",
    content: "As Chairman of the House Committee on Customs and Excise, Hon. Leke Abejide conducted a thorough inspection and oversight visit to the Nigerian Customs Service Headquarters to ensure accountability and efficiency in operations.",
    featured: false
  },
  {
    id: 6,
    title: "Rt. Hon Leke Abejide Fulfils Campaign Promise With 100Million Naira Empowerment Fund For Women",
    category: "Empowerment",
    date: "July 13th '24",
    image: "image/Campaign.jpg",
    excerpt: "Rt. Hon Leke Abejide fulfils campaign promise with 100million naira empowerment fund for women across Yagba Federal Constituency.",
    content: "Rt. Hon Leke Abejide has fulfilled his campaign promise by providing a 100 million naira empowerment fund for women across Yagba Federal Constituency, demonstrating his commitment to gender empowerment and economic development.",
    featured: true
  },
  {
    id: 7,
    title: "Leke Abejide Foundation Set To Train Cooperative Societies in Kogi West",
    category: "Foundation",
    date: "July 12th '24",
    image: "image/loan disbursement.jpg",
    excerpt: "Leke Abejide Foundation set to train cooperative societies in Kogi West.",
    content: "The Leke Abejide Foundation has announced plans to train cooperative societies across Kogi West, empowering communities with financial management skills and business development opportunities.",
    featured: false
  },
  {
    id: 8,
    title: "Leke Abejide Foundation Launched Vaccination For Children Across Yagba",
    category: "Foundation",
    date: "June 24th '24",
    image: "image/leke.jpg",
    excerpt: "Leke Abejide Foundation launched vaccination for children across Yagba.",
    content: "The Leke Abejide Foundation launched a comprehensive vaccination drive for children across Yagba, providing free vaccinations to protect children against preventable diseases.",
    featured: true
  },
  {
    id: 9,
    title: "Breach of Privilege by Adeola Fayehun",
    category: "Latest News",
    date: "March 2024",
    image: "image/adeola.png",
    excerpt: "Hon. Leke Abejide on the Breach of Privilege by one Adeola Fayehun who published false information.",
    content: `Adeola Fayehun published false information against the members, House of Representatives on her social media handles.

This information has significantly harmed the reputation of the legislators and disrupted their ability to perform their duties effectively.

These claims were unfounded and not supported by any verifiable evidence.

Hon. Leke Abejide demands legal actions be taken on Adeola, to stop future reoccurrence.`,
    featured: false,
    hasVideo: true,
    videoSrc: "video.mp4"
  }
];

let nextPostId = 10;

let comments = [];
let nextCommentId = 1;

let subscribers = [];
let contactMessages = [];
let nextMsgId = 1;

// Site settings — admin-editable
let siteSettings = {
  heroTitle: "Hon. Leke Abejide",
  heroSubtitle: "Member, House of Representatives · Yagba Federal Constituency · Chairman, House Committee on Customs & Excise",
  footerAbout: "Rt. Hon. Elder Leke Joseph Abejide — Member, House of Representatives, Yagba Federal Constituency, Kogi State.",
  facebookUrl: "https://www.facebook.com/profile.php?id=100051326707777",
  instagramUrl: "https://www.instagram.com/hon.lekeabejide",
  twitterUrl: "#",
  contactEmail: "ayanisolomon1@gmail.com",
  navLinks: [
    { label: "Blog", href: "/" },
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" }
  ]
};

// Admin credentials — loaded from .env (never hardcode these in production)
const adminUser = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'changeme',
  name:     process.env.ADMIN_NAME     || 'Site Administrator'
};

// ── Helper functions ───────────────────────────────────

function getAllPosts() { return [...posts]; }

function getPostById(id) { return posts.find(p => p.id === id) || null; }

function createPost(data) {
  const post = {
    id: nextPostId++,
    title: data.title,
    category: data.category,
    date: data.date || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    image: data.image || '',
    excerpt: data.excerpt,
    content: data.content,
    featured: data.featured === true || data.featured === 'true',
    hasVideo: data.hasVideo === true || data.hasVideo === 'true',
    videoSrc: data.videoSrc || ''
  };
  posts.unshift(post);
  return post;
}

function updatePost(id, data) {
  const idx = posts.findIndex(p => p.id === id);
  if (idx === -1) return null;
  posts[idx] = {
    ...posts[idx],
    title: data.title !== undefined ? data.title : posts[idx].title,
    category: data.category !== undefined ? data.category : posts[idx].category,
    date: data.date !== undefined ? data.date : posts[idx].date,
    image: data.image !== undefined ? data.image : posts[idx].image,
    excerpt: data.excerpt !== undefined ? data.excerpt : posts[idx].excerpt,
    content: data.content !== undefined ? data.content : posts[idx].content,
    featured: data.featured !== undefined ? (data.featured === true || data.featured === 'true') : posts[idx].featured,
    hasVideo: data.hasVideo !== undefined ? (data.hasVideo === true || data.hasVideo === 'true') : posts[idx].hasVideo,
    videoSrc: data.videoSrc !== undefined ? data.videoSrc : posts[idx].videoSrc
  };
  return posts[idx];
}

function deletePost(id) {
  const idx = posts.findIndex(p => p.id === id);
  if (idx === -1) return false;
  posts.splice(idx, 1);
  return true;
}

function toggleFeatured(id) {
  const post = posts.find(p => p.id === id);
  if (!post) return null;
  post.featured = !post.featured;
  return post;
}

function getCategories() {
  return [...new Set(posts.map(p => p.category))];
}

function getSliderPosts() {
  return posts
    .filter(p => p.featured)
    .map(p => ({ id: p.id, image: p.image, title: p.title, link: `/post/${p.id}` }));
}

// Comments
function getCommentsByPost(postId) {
  return comments.filter(c => c.postId === postId);
}

function addComment(postId, name, email, message) {
  const comment = {
    id: nextCommentId++,
    postId,
    name: name.trim(),
    email: email.trim(),
    message: message.trim(),
    date: new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
    approved: true
  };
  comments.push(comment);
  return comment;
}

function deleteComment(id) {
  const idx = comments.findIndex(c => c.id === id);
  if (idx === -1) return false;
  comments.splice(idx, 1);
  return true;
}

function getAllComments() { return [...comments]; }

// Contact messages
function addContactMessage(name, email, subject, message) {
  const msg = {
    id: nextMsgId++,
    name: name.trim(),
    email: email.trim(),
    subject: subject.trim(),
    message: message.trim(),
    date: new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
    read: false
  };
  contactMessages.push(msg);
  return msg;
}

function getAllMessages() { return [...contactMessages]; }
function markMessageRead(id) {
  const msg = contactMessages.find(m => m.id === id);
  if (msg) msg.read = true;
  return msg;
}
function deleteMessage(id) {
  const idx = contactMessages.findIndex(m => m.id === id);
  if (idx === -1) return false;
  contactMessages.splice(idx, 1);
  return true;
}

// Subscribers
function addSubscriber(email) {
  const existing = subscribers.find(s => s.email === email.toLowerCase());
  if (existing) return { exists: true };
  const sub = { id: subscribers.length + 1, email: email.toLowerCase(), date: new Date().toLocaleDateString('en-GB') };
  subscribers.push(sub);
  return { exists: false, sub };
}
function getAllSubscribers() { return [...subscribers]; }
function deleteSubscriber(id) {
  const idx = subscribers.findIndex(s => s.id === id);
  if (idx === -1) return false;
  subscribers.splice(idx, 1);
  return true;
}

// Settings
function getSettings() { return { ...siteSettings }; }
function updateSettings(data) {
  siteSettings = { ...siteSettings, ...data };
  return siteSettings;
}

// Stats
function getStats() {
  return {
    totalPosts: posts.length,
    featuredPosts: posts.filter(p => p.featured).length,
    totalComments: comments.length,
    totalMessages: contactMessages.length,
    unreadMessages: contactMessages.filter(m => !m.read).length,
    totalSubscribers: subscribers.length,
    categories: getCategories().length
  };
}

module.exports = {
  adminUser,
  getAllPosts, getPostById, createPost, updatePost, deletePost, toggleFeatured,
  getCategories, getSliderPosts,
  getCommentsByPost, addComment, deleteComment, getAllComments,
  addContactMessage, getAllMessages, markMessageRead, deleteMessage,
  addSubscriber, getAllSubscribers, deleteSubscriber,
  getSettings, updateSettings,
  getStats
};
