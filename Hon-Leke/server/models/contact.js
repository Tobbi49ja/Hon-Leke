// server/routes/contact.js
const express = require('express');
const router  = express.Router();
const store   = require('../data/store');

// POST /api/contact
router.post('/', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    }

    await store.addContactMessage(name, email, subject, message);

    // Optionally send email if SMTP configured
    if (process.env.SMTP_HOST) {
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host:   process.env.SMTP_HOST,
          port:   parseInt(process.env.SMTP_PORT) || 587,
          secure: false,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
        await transporter.sendMail({
          from:    `"${name}" <${process.env.SMTP_USER}>`,
          replyTo: email,
          to:      process.env.RECEIVING_EMAIL || 'ayanisolomon1@gmail.com',
          subject: `[Blog Contact] ${subject}`,
          html:    `<h2>New Contact Message</h2><p><b>From:</b> ${name} &lt;${email}&gt;</p><p><b>Subject:</b> ${subject}</p><p><b>Message:</b><br>${message.replace(/\n/g, '<br>')}</p>`
        });
      } catch (err) {
        console.error('Email error:', err.message);
      }
    }

    res.json({ success: true, message: 'Your message has been received. Thank you!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/subscribe
router.post('/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Invalid email.' });

    const result = await store.addSubscriber(email);
    if (result.exists) return res.json({ success: true, message: 'You are already subscribed!' });
    res.json({ success: true, message: 'Thank you for subscribing!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;