const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-clean-core-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Persistent Transporter Pool with Anti-Spam Socket Settings
const transporterCache = {};

function getTransporter(gmailId, appPassword) {
  const cacheKey = `${gmailId}:${appPassword}`;
  if (!transporterCache[cacheKey]) {
    transporterCache[cacheKey] = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // SSL Connection
      pool: true,
      maxConnections: 2, // Controlled concurrent sockets for Google limit safety
      maxMessages: 50,
      auth: { user: gmailId, pass: appPassword },
      tls: {
        rejectUnauthorized: true
      }
    });
  }
  return transporterCache[cacheKey];
}

function requireLogin(req, res, next) {
  if (req.session?.loggedIn) return next();
  res.redirect('/');
}

// Page Routes
app.get('/', (req, res) => {
  if (req.session?.loggedIn) return res.redirect('/launcher');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/launcher', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

// Auth Handlers
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || 'rrrr';
  const validPass = process.env.ADMIN_PASS || 'rrrr';
  
  if (username === validUser && password === validPass) {
    req.session.loggedIn = true;
    return req.session.save((err) => {
      if (err) return res.status(500).json({ success: false, message: 'Session error' });
      res.json({ success: true });
    });
  }
  res.status(401).json({ success: false, message: 'Invalid credentials' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// Optimized Email Sending API
app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;

  if (!gmailId || !appPassword || !to || !messageBody) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const cleanGmailId  = gmailId.trim();
  const cleanPassword = appPassword.replace(/\s+/g, '');
  const cleanTo       = to.trim();
  const cleanSubject  = subject ? subject.trim() : 'Notification';

  try {
    const transporter = getTransporter(cleanGmailId, cleanPassword);

    const fromFormatted = senderName && senderName.trim()
      ? `"${senderName.trim()}" <${cleanGmailId}>`
      : cleanGmailId;

    // Inboxing Optimization: Add Clean HTML Version Alongside Text
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6;">
        ${messageBody.trim().replace(/\n/g, '<br>')}
      </div>
    `;

    // Natural Delay to Avoid Immediate Google Rate Limit Trigger
    const randomDelay = Math.floor(Math.random() * (3500 - 1500 + 1)) + 1500;
    await new Promise(resolve => setTimeout(resolve, randomDelay));

    const info = await transporter.sendMail({
      from: fromFormatted,
      to: cleanTo,
      subject: cleanSubject,
      text: messageBody.trim(),
      html: htmlBody,
      headers: {
        'X-Mailer': 'Microsoft Outlook 16.0', // Standard mail client header signature
        'X-Priority': '3',
        'Importance': 'Normal'
      }
    });

    res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error(`❌ Delivery error for ${cleanTo}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Fast Mailer running cleanly on port ${PORT}`));
