// server/routes/contact.js
const express = require('express');
const router = express.Router();
const store = require('../data/store');

// POST /api/contact
router.post('/', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address.' });
  }

  store.addContactMessage(name, email, subject, message);

  // Send email via Resend if API key is configured
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: `Hon. Leke Abejide Blog <no-reply@lekejosephabejide.com>`,
        replyTo: email,
        to: process.env.RECEIVING_EMAIL || 'ayanisolomon1@gmail.com',
        subject: `[Blog Contact] ${subject}`,
        html: `
          <h2 style="color:#1a3c5e">New Contact Message</h2>
          <p><b>From:</b> ${name} &lt;${email}&gt;</p>
          <p><b>Subject:</b> ${subject}</p>
          <hr>
          <p><b>Message:</b><br>${message.replace(/\n/g, '<br>')}</p>
          <hr>
          <p style="color:#718096;font-size:12px">Sent from lekejosephabejide.com contact form</p>
        `
      });
    } catch (err) {
      console.error('Resend email error:', err.message);
    }
  }

  res.json({ success: true, message: 'Your message has been received. Thank you!' });
});

// POST /api/subscribe
router.post('/subscribe', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Invalid email.' });

  const result = store.addSubscriber(email);
  if (result.exists) return res.json({ success: true, message: 'You are already subscribed!' });
  res.json({ success: true, message: 'Thank you for subscribing!' });
});

module.exports = router;
