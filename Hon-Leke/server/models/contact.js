// server/routes/contact.js
const express = require('express');
const router  = express.Router();
const store   = require('../data/store');

// ── Resend setup ──────────────────────────────────────────────────────────────
// Install: npm install resend
// Required env vars:
//   RESEND_API_KEY=re_xxxxxxxxxxxx
//   RECEIVING_EMAIL=ayanisolomon1@gmail.com   (who gets the contact messages)
//   RESEND_FROM=Hon. Leke Blog <noreply@yourdomain.com>  (optional override)
// --------------------------------------------------------------------------
let resendClient = null;

if (process.env.RESEND_API_KEY) {
  try {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
    console.log('✅ Resend email configured.');
  } catch (e) {
    console.warn('⚠️  Resend package not found. Run: npm install resend');
  }
} else {
  console.log('ℹ️  RESEND_API_KEY not set — emails will be stored only, not sent.');
}

// The "from" address must be from a domain you've verified in Resend.
// During testing you can use the default sandbox address below.
const FROM_ADDRESS =
  process.env.RESEND_FROM || 'Hon. Leke Blog <onboarding@resend.dev>';

const TO_ADDRESS =
  process.env.RECEIVING_EMAIL || 'ayanisolomon1@gmail.com';

// ── POST /api/contact ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message)
    return res.status(400).json({ success: false, message: 'All fields are required.' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email))
    return res.status(400).json({ success: false, message: 'Invalid email address.' });

  // Always save to DB first
  try {
    await store.addContactMessage(name, email, subject, message);
  } catch (err) {
    console.error('DB save error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save message.' });
  }

  // Send email notification via Resend (non-blocking — don't fail the request if email fails)
  if (resendClient) {
    resendClient.emails.send({
      from:     FROM_ADDRESS,
      to:       TO_ADDRESS,
      replyTo:  email,
      subject:  `[Blog Contact] ${subject}`,
      html: `
        <h2 style="color:#1a3c5e">New Contact Message</h2>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:8px;font-weight:bold;width:100px">From</td>
              <td style="padding:8px">${name} &lt;${email}&gt;</td></tr>
          <tr style="background:#f5f5f5">
              <td style="padding:8px;font-weight:bold">Subject</td>
              <td style="padding:8px">${subject}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;vertical-align:top">Message</td>
              <td style="padding:8px">${message.replace(/\n/g, '<br>')}</td></tr>
        </table>
        <p style="color:#888;font-size:12px;margin-top:24px">
          Sent via Hon. Leke Abejide Blog contact form.
        </p>
      `,
    }).catch(err => console.error('Resend send error:', err.message));
  }

  res.json({ success: true, message: 'Your message has been received. Thank you!' });
});

// ── POST /api/subscribe ───────────────────────────────────────────────────────
// Mounted at /api/subscribe via server.js middleware re-route
router.post('/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ success: false, message: 'Email is required.' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email))
    return res.status(400).json({ success: false, message: 'Invalid email.' });

  try {
    const result = await store.addSubscriber(email);
    if (result.exists)
      return res.json({ success: true, message: 'You are already subscribed!' });
  } catch (err) {
    console.error('Subscribe DB error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save subscription.' });
  }

  // Welcome email
  if (resendClient) {
    resendClient.emails.send({
      from:    FROM_ADDRESS,
      to:      email,
      subject: "You're subscribed to Hon. Leke Abejide's Blog",
      html: `
        <h2 style="color:#1a3c5e">Welcome!</h2>
        <p>Thank you for subscribing. You'll receive updates from Hon. Leke Abejide's blog.</p>
        <p style="color:#888;font-size:12px;margin-top:24px">
          Hon. Leke Abejide — Member, House of Representatives, Yagba Federal Constituency.
        </p>
      `,
    }).catch(err => console.error('Resend subscribe email error:', err.message));
  }

  res.json({ success: true, message: 'Thank you for subscribing!' });
});

module.exports = router;