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

// Sleep helper for human-like rate spacing
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Mandatory Zero-Width Fingerprinting to defeat duplicate spam detection
function applyMandatoryAntiSpamFingerprint(content) {
    const zeroWidthChars = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
    let fingerprint = '';
    for (let i = 0; i < 12; i++) {
        fingerprint += zeroWidthChars[Math.floor(Math.random() * zeroWidthChars.length)];
    }
    
    if (/<[a-z][\s\S]*>/i.test(content)) {
        return content + `<span style="display:none !important; font-size:0px; line-height:0px; opacity:0; color:transparent;">${fingerprint}</span>`;
    }
    return content + fingerprint;
}

// Auto-sanitize content to neutralize common spam trigger terms
function autoSanitizeText(text) {
    if (!text) return '';
    return text.replace(/\b(100% free|make money|click here now|guaranteed|cash bonus|unbelievable|buy now|urgent action)\b/gi, (match) => {
        return match.split('').join('\u200B');
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

    const { gmailUser, appPass, emailListText, subject, body } = req.body;

    // Auto-Verification Step 1: Input Validation
    if (!gmailUser || !appPass) {
        res.write(`data: ${JSON.stringify({ error: "Gmail Address ya App Password missing hai! ❌" })}\n\n`);
        return res.end();
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');
    const senderDomain = cleanUser.split('@')[1] || 'gmail.com';
    const senderName = cleanUser.split('@')[0];

    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        res.write(`data: ${JSON.stringify({ error: "Koyi valid recipient email nahi mila! ❌" })}\n\n`);
        return res.end();
    }

    if (!checkAndTrackLimit(cleanUser, emails.length)) {
        res.write(`data: ${JSON.stringify({ error: "Hourly Limit Exceeded (Max 450/hr allowed) ❌" })}\n\n`);
        return res.end();
    }

    // Auto-Verification Step 2: Establish Secure Connection
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
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

    // Auto-Verification Step 3: SMTP Handshake Test
    try {
        await transporter.verify();
    } catch (authError) {
        res.write(`data: ${JSON.stringify({ error: "Auto-Verification Failed: App Password galat hai ya SMTP connect nahi ho pa raha! ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;
    let processedSoFar = 0;

    const isHtmlContent = /<[a-z][\s\S]*>/i.test(body);

    // Mandatory Anti-Spam Processing
    const sanitizedSubject = autoSanitizeText(subject);
    const sanitizedBody = autoSanitizeText(body);

    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];
        const uniqueMessageId = `${crypto.randomBytes(8).toString('hex')}.${Date.now()}@${senderDomain}`;
        
        // Mandatory Anti-Spam Fingerprint Injection per recipient
        const fingerprintedBody = applyMandatoryAntiSpamFingerprint(sanitizedBody);

        const htmlPayload = isHtmlContent 
            ? fingerprintedBody 
            : `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #1f2937; line-height: 1.6;">${fingerprintedBody.replace(/\n/g, '<br>')}</div>`;

        const plainText = fingerprintedBody.replace(/<[^>]*>?/gm, '').trim();

        // Optimized Mail Options (NO Unsubscribe Headers)
        const mailOptions = {
            from: `"${senderName}" <${cleanUser}>`,
            to: recipient,
            subject: sanitizedSubject,
            text: plainText,
            html: htmlPayload,
            headers: {
                'Message-ID': `<${uniqueMessageId}>`,
                'X-Mailer': 'Apple Mail (2.3654.120.8)',
                'X-Priority': '3',
                'X-MSMail-Priority': 'Normal',
                'X-Entity-Ref-ID': `${crypto.randomBytes(6).toString('hex')}`
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

        // Random jitter delay (400ms - 800ms) to ensure primary inbox routing
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
