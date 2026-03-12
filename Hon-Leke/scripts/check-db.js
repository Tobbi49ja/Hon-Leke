// scripts/check-db.js
// Run: node scripts/check-db.js

require('dotenv').config();
const mongoose = require('mongoose');

async function check() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  await mongoose.connect(uri);
  console.log('Connected:', mongoose.connection.host);

  const db = mongoose.connection.db;

  // List all collections
  const collections = await db.listCollections().toArray();
  console.log('\nCollections:', collections.map(c => c.name));

  // Count posts
  const count = await db.collection('posts').countDocuments();
  console.log('\nTotal posts in DB:', count);

  // Show first 3 posts raw
  const posts = await db.collection('posts').find({}).limit(3).toArray();
  console.log('\nFirst 3 posts (raw):');
  posts.forEach((p, i) => {
    console.log(`\n[${i+1}] _id: ${p._id}`);
    console.log('    title:', p.title);
    console.log('    category:', p.category);
    console.log('    keys:', Object.keys(p).join(', '));
  });

  // Show all indexes on posts
  const indexes = await db.collection('posts').indexes();
  console.log('\nIndexes on posts:');
  indexes.forEach(idx => console.log(' -', idx.name, JSON.stringify(idx.key), idx.unique ? '(UNIQUE)' : ''));

  await mongoose.disconnect();
  process.exit(0);
}

check().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});