const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory hourly tracking to protect account reputation
const emailTracker = {};

// Sleep Helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fast Speed Delay (1.0 to 2.0 seconds) as requested
const getFastDelay = () => Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;

// Dynamic Spintax Parser: converts "{Hi|Hello|Hey}" into random choice
function parseSpintax(text) {
    if (!text) return '';
    return text.replace(/\{([^{}]+)\}/g, (match, choices) => {
        const options = choices.split('|');
        return options[Math.floor(Math.random() * options.length)].trim();
    });
}

// Automatic Spam Trigger Cleaner: breaks trigger patterns without losing context
function sanitizeSpamWords(text) {
    if (!text) return '';
    const spamRegex = /\b(FREE|BUY NOW|100%|CLICK HERE|EARN MONEY|URGENT|GUARANTEED|LIMITED TIME|BEST PRICE|MAKE MONEY|NO RISK|ACT NOW)\b/gi;
    return text.replace(spamRegex, (match) => {
        return match.charAt(0) + ' ' + match.slice(1);
    });
}

// Track Hourly Limits (Max 30 mails/hr for raw Gmail SMTP to stay in Primary Inbox)
function checkAndTrackLimit(senderEmail, countToAdd) {
    const now = Date.now();
    const ONE_HOUR = 3600000;

    if (!emailTracker[senderEmail]) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    if (now - emailTracker[senderEmail].startTime > ONE_HOUR) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    if (emailTracker[senderEmail].count + countToAdd > 30) {
        return false;
    }

    return true;
}

app.post('/api/send-direct', async (req, res) => {
    // SSE Headers for Realtime Progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { senderName, gmailUser, appPass, emailListText, subject, body } = req.body;

    if (!gmailUser || !appPass) {
        res.write(`data: ${JSON.stringify({ error: "Gmail address or App Password missing! ❌" })}\n\n`);
        return res.end();
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');
    const cleanSenderName = senderName && senderName.trim() ? senderName.trim() : cleanUser.split('@')[0];

    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        res.write(`data: ${JSON.stringify({ error: "No valid recipient email addresses found! ❌" })}\n\n`);
        return res.end();
    }

    if (!checkAndTrackLimit(cleanUser, emails.length)) {
        res.write(`data: ${JSON.stringify({ error: "Safe Hourly Limit Reached! Max 30 mails/hr for 100% Inbox Placement. ❌" })}\n\n`);
        return res.end();
    }

    // High-Trust Transporter Configuration
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: cleanUser,
            pass: cleanPass
        },
        pool: true,
        maxConnections: 2,
        maxMessages: 50,
        rateDelta: 1000,
        rateLimit: 1
    });

    try {
        await transporter.verify();
    } catch (authError) {
        res.write(`data: ${JSON.stringify({ error: "Authentication Failed! Verify your 16-digit Google App Password. ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;
    let processedSoFar = 0;

    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];

        // Process Spintax and Sanitize Triggers for each recipient
        const dynamicSubject = sanitizeSpamWords(parseSpintax(subject));
        const dynamicBody = sanitizeSpamWords(parseSpintax(body));

        // RFC-Compliant Unique Message ID Generation
        const domain = cleanUser.split('@')[1] || 'gmail.com';
        const uniqueMsgId = `<${crypto.randomBytes(12).toString('hex')}.${Date.now()}@${domain}>`;
        
        // Clean Plain Text version without HTML tags
        const plainTextVersion = dynamicBody.replace(/<[^>]*>?/gm, '').trim();

        // Optimized Mail Options for 100% Primary Inbox Delivery
        const mailOptions = {
            from: `"${cleanSenderName}" <${cleanUser}>`,
            to: recipient,
            replyTo: cleanUser,
            subject: dynamicSubject,
            text: plainTextVersion,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #1f2937; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 10px;">
                    ${dynamicBody.replace(/\n/g, '<br>')}
                </div>
            `,
            headers: {
                'Message-ID': uniqueMsgId,
                'X-Mailer': 'Apple Mail (2.3654.120.8)',
                'X-Priority': '3',
                'MIME-Version': '1.0',
                'X-Auto-Response-Suppress': 'OOF, AutoReply',
                'List-Unsubscribe': `<mailto:${cleanUser}?subject=Unsubscribe>`,
                'Precedence': 'bulk'
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
            emailTracker[cleanUser].count++;
        } catch (err) {
            console.error(`Failed delivery to ${recipient}:`, err.message);
            failedCount++;
        } finally {
            processedSoFar++;
            res.write(`data: ${JSON.stringify({ progress: true, sent: processedSoFar, total: emails.length })}\n\n`);
        }

        // Fast Speed Delay (1 to 2 seconds)
        if (i < emails.length - 1) {
            const delay = getFastDelay();
            await sleep(delay);
        }
    }

    transporter.close();

    res.write(`data: ${JSON.stringify({ completed: true, total: emails.length, delivered: successCount, failed: failedCount })}\n\n`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running safely on http://localhost:${PORT}`);
});
