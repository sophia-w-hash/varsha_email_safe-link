const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const emailTracker = {};

// Helper: Sleep function for human-like delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Generate zero-width invisible unique fingerprint to defeat duplicate detection
function injectSpamProtectionFingerprint(content) {
    const zeroWidthChars = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
    let fingerprint = '';
    for (let i = 0; i < 10; i++) {
        fingerprint += zeroWidthChars[Math.floor(Math.random() * zeroWidthChars.length)];
    }
    
    // Inject invisible fingerprint into HTML or Plain Text
    if (/<[a-z][\s\S]*>/i.test(content)) {
        return content + `<span style="display:none !important; font-size:0px; line-height:0px; opacity:0;">${fingerprint}</span>`;
    }
    return content + fingerprint;
}

// Helper: Clean & Sanitize Subject/Body for Max Inbox Delivery
function sanitizeContent(text) {
    if (!text) return '';
    // Prevent trigger words from locking into spam
    return text.replace(/\b(100% free|make money|click here now|guaranteed|cash bonus|unbelievable)\b/gi, (match) => {
        return match.split('').join('\u200B'); // Insert invisible zero-width space in bad keywords
    });
}

function checkAndTrackLimit(senderEmail, countToAdd) {
    const now = Date.now();
    const ONE_HOUR = 3600000;

    if (!emailTracker[senderEmail]) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    if (now - emailTracker[senderEmail].startTime > ONE_HOUR) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    if (emailTracker[senderEmail].count + countToAdd > 450) {
        return false;
    }

    return true;
}

app.post('/api/send-direct', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { gmailUser, appPass, emailListText, subject, body, spamProtection = true } = req.body;

    if (!gmailUser || !appPass) {
        res.write(`data: ${JSON.stringify({ error: "Gmail Address ya App Password galat hai! ❌" })}\n\n`);
        return res.end();
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');
    const senderDomain = cleanUser.split('@')[1] || 'gmail.com';
    const displayName = cleanUser.split('@')[0];

    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        res.write(`data: ${JSON.stringify({ error: "Koyi valid email address nahi mila! ❌" })}\n\n`);
        return res.end();
    }

    if (!checkAndTrackLimit(cleanUser, emails.length)) {
        res.write(`data: ${JSON.stringify({ error: "Hourly Limit Exceeded (Max 450/hr allowed) ❌" })}\n\n`);
        return res.end();
    }

    // SMTP Transporter configuration optimized for Primary Inbox
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // SSL connection for high trust score
        pool: true,
        maxConnections: 1,
        maxMessages: 100,
        auth: {
            user: cleanUser,
            pass: cleanPass
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    try {
        await transporter.verify();
    } catch (authError) {
        res.write(`data: ${JSON.stringify({ error: "Authentication Failed! App Password check karein. ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;
    let processedSoFar = 0;

    const isHtmlContent = /<[a-z][\s\S]*>/i.test(body);
    const sanitizedSubject = spamProtection ? sanitizeContent(subject) : subject;
    const baseBody = spamProtection ? sanitizeContent(body) : body;

    // Send emails sequentially with Anti-Spam protection
    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];
        const uniqueMessageId = `${crypto.randomBytes(8).toString('hex')}.${Date.now()}@${senderDomain}`;
        
        // Dynamic uniquely fingerprinted body per recipient
        let finalBody = spamProtection ? injectSpamProtectionFingerprint(baseBody) : baseBody;

        let htmlPayload = isHtmlContent 
            ? finalBody 
            : `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #1f2937; line-height: 1.6;">${finalBody.replace(/\n/g, '<br>')}</div>`;

        const plainText = finalBody.replace(/<[^>]*>?/gm, '').trim();

        const mailOptions = {
            from: `"${displayName}" <${cleanUser}>`,
            to: recipient,
            subject: sanitizedSubject,
            text: plainText,
            html: htmlPayload,
            headers: {
                'Message-ID': `<${uniqueMessageId}>`,
                'X-Mailer': 'Apple Mail (2.3654.120.8)',
                'X-Report-Abuse-To': `<mailto:abuse@${senderDomain}>`,
                'List-Unsubscribe': `<mailto:${cleanUser}?subject=unsubscribe>`,
                'Auto-Submitted': 'auto-generated'
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
            emailTracker[cleanUser].count++;
        } catch (err) {
            console.error(`Failed sending to ${recipient}:`, err.message);
            failedCount++;
        } finally {
            processedSoFar++;
            res.write(`data: ${JSON.stringify({ progress: true, sent: processedSoFar, total: emails.length })}\n\n`);
        }

        // Delay algorithm: 400ms - 800ms jitter delay to simulate real human dispatch
        if (i < emails.length - 1) {
            const delay = Math.floor(Math.random() * 400) + 400;
            await sleep(delay);
        }
    }

    transporter.close();

    res.write(`data: ${JSON.stringify({ completed: true, total: emails.length, delivered: successCount, failed: failedCount })}\n\n`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
