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

// Humanized delay generator (6000ms to 10000ms) to prevent Instant Spam Flagging
const getRandomDelay = () => Math.floor(Math.random() * (10000 - 6000 + 1)) + 6000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function checkAndTrackLimit(senderEmail, countToAdd) {
    const now = Date.now();
    const ONE_HOUR = 3600000;

    if (!emailTracker[senderEmail]) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    if (now - emailTracker[senderEmail].startTime > ONE_HOUR) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    if (emailTracker[senderEmail].count + countToAdd > 25) {
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
        res.write(`data: ${JSON.stringify({ error: "Wrong Password or Missing Credentials ❌" })}\n\n`);
        return res.end();
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');
    const cleanSenderName = senderName && senderName.trim() ? senderName.trim() : cleanUser.split('@')[0];
    const senderDomain = cleanUser.split('@')[1] || 'gmail.com';

    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        res.write(`data: ${JSON.stringify({ error: "No valid emails found ❌" })}\n\n`);
        return res.end();
    }

    if (!checkAndTrackLimit(cleanUser, emails.length)) {
        res.write(`data: ${JSON.stringify({ error: "Hourly Limit Reached (Max 25/hr) ❌" })}\n\n`);
        return res.end();
    }

    // High Trust Direct Connection Setup
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
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
        res.write(`data: ${JSON.stringify({ error: "Authentication Failed! App Password re-check karein. ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;
    let processedSoFar = 0;

    // Remove any raw HTML tags to guarantee a clean text body
    const cleanBodyText = body.replace(/<[^>]*>?/gm, '').trim();

    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];
        const uniqueToken = crypto.randomBytes(6).toString('hex');
        const uniqueMessageId = `<${uniqueToken}.${Date.now()}@${senderDomain}>`;

        // Clean dual-part structure (Text + Mild HTML) for max filter pass-through
        const mailOptions = {
            from: `"${cleanSenderName}" <${cleanUser}>`,
            to: recipient,
            subject: subject,
            text: cleanBodyText,
            html: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #222222; line-height: 1.6;">${cleanBodyText.replace(/\n/g, '<br>')}</div>`,
            headers: {
                'Message-ID': uniqueMessageId,
                'X-Mailer': 'Apple Mail (2.3654.120.8)',
                'MIME-Version': '1.0'
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
            emailTracker[cleanUser].count++;
        } catch (err) {
            console.error(`Error sending to ${recipient}:`, err.message);
            failedCount++;
        } finally {
            processedSoFar++;
            res.write(`data: ${JSON.stringify({ progress: true, sent: processedSoFar, total: emails.length })}\n\n`);
        }

        // Apply intelligent humanized delay between requests
        if (i < emails.length - 1) {
            const delay = getRandomDelay();
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
