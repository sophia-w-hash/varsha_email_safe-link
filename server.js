const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const emailTracker = {};

// Sleep Helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Random Human-like Delay (1 to 2 seconds) - Crucial for Inbox Rate
const getHumanDelay = () => Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;

// Dynamic Text Variable Generator (Spintax Parser)
// Example Input: "{Hi|Hello|Hey} {Friend|User}, hope you are doing well!"
function parseSpintax(text) {
    if (!text) return '';
    return text.replace(/\{([^{}]+)\}/g, (match, choices) => {
        const options = choices.split('|');
        return options[Math.floor(Math.random() * options.length)];
    });
}

// Automatic Spam Trigger Cleaner
function sanitizeSpamWords(text) {
    if (!text) return '';
    return text
        .replace(/\b(FREE|BUY NOW|100%|CLICK HERE|EARN MONEY|URGENT|GUARANTEED)\b/gi, (match) => {
            return match.charAt(0) + ' ' + match.slice(1); // Adds space between letters to bypass regex filters
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

    // Recommended limit for 99% Primary Inbox delivery
    if (emailTracker[senderEmail].count + countToAdd > 20) {
        return false;
    }

    return true;
}

app.post('/api/send-direct', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { senderName, gmailUser, appPass, emailListText, subject, body } = req.body;

    if (!gmailUser || !appPass) {
        res.write(`data: ${JSON.stringify({ error: "Gmail or App Password missing! ❌" })}\n\n`);
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
        res.write(`data: ${JSON.stringify({ error: "No valid recipient email address! ❌" })}\n\n`);
        return res.end();
    }

    if (!checkAndTrackLimit(cleanUser, emails.length)) {
        res.write(`data: ${JSON.stringify({ error: "Safe Hourly Limit Reached (Max 20 Mails/Hour for High Inbox Rate) ❌" })}\n\n`);
        return res.end();
    }

    // Direct High-Priority Transport
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: cleanUser,
            pass: cleanPass
        },
        pool: true,
        maxConnections: 1,
        maxMessages: 10000
    });

    try {
        await transporter.verify();
    } catch (authError) {
        res.write(`data: ${JSON.stringify({ error: "Authentication Failed! Check your 16-digit App Password. ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;
    let processedSoFar = 0;

    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];

        // Unique dynamic Spintax resolution per recipient
        const dynamicSubject = sanitizeSpamWords(parseSpintax(subject));
        const dynamicBody = sanitizeSpamWords(parseSpintax(body));

        const domain = cleanUser.split('@')[1] || 'gmail.com';
        const uniqueMessageId = `<${crypto.randomBytes(12).toString('hex')}@${domain}>`;

        const mailOptions = {
            from: `"${cleanSenderName}" <${cleanUser}>`,
            to: recipient,
            subject: dynamicSubject,
            text: dynamicBody,
            html: `<div style="font-family: Arial, sans-serif; font-size: 15px; color: #1a1a1a; line-height: 1.6;">${dynamicBody.replace(/\n/g, '<br>')}</div>`,
            headers: {
                'Message-ID': uniqueMessageId,
                'X-Mailer': 'Outlook-Express/11.0',
                'X-Priority': '3',
                'MIME-Version': '1.0'
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
            emailTracker[cleanUser].count++;
        } catch (err) {
            console.error(`Failed to deliver email to ${recipient}:`, err.message);
            failedCount++;
        } finally {
            processedSoFar++;
            res.write(`data: ${JSON.stringify({ progress: true, sent: processedSoFar, total: emails.length })}\n\n`);
        }

        // Apply Natural Humanized Delay
        if (i < emails.length - 1) {
            const delay = getHumanDelay();
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
