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

// Human-like random delay (5 to 12 seconds per email for maximum inboxing)
const getRandomDelay = () => Math.floor(Math.random() * (12000 - 5000 + 1)) + 5000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function extractCleanText(content) {
    if (!content) return '';
    return content
        .replace(/<br\s*[\/]?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]*>/g, '')
        .trim();
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

    if (emailTracker[senderEmail].count + countToAdd > 150) { // Keep under 150/hr for safety
        return false;
    }

    return true;
}

app.post('/api/send-direct', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { gmailUser, appPass, emailListText, subject, body } = req.body;

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
        res.write(`data: ${JSON.stringify({ error: "Safe Hourly Limit Exceeded (Max 150/hr for Inbox Safety) ❌" })}\n\n`);
        return res.end();
    }

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
        res.write(`data: ${JSON.stringify({ error: "Authentication Failed: Gmail App Password galat hai ya SMTP blocked hai! ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;
    let processedSoFar = 0;

    const isHtmlContent = /<[a-z][\s\S]*>/i.test(body);

    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];
        const uniqueToken = crypto.randomBytes(6).toString('hex');
        const uniqueMessageId = `<${uniqueToken}.${Date.now()}@${senderDomain}>`;

        const htmlPayload = isHtmlContent 
            ? body 
            : `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.5;">${body.replace(/\n/g, '<br>')}</div>`;

        const plainTextPayload = extractCleanText(body);

        // Standard clean mail headers for high trust landing
        const mailOptions = {
            from: `"${senderName}" <${cleanUser}>`,
            to: recipient,
            subject: subject,
            text: plainTextPayload,
            html: htmlPayload,
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
            console.error(`Sending failed to ${recipient}:`, err.message);
            failedCount++;
        } finally {
            processedSoFar++;
            res.write(`data: ${JSON.stringify({ progress: true, sent: processedSoFar, total: emails.length })}\n\n`);
        }

        // Apply human sending interval between each mail
        if (i < emails.length - 1) {
            const waitTime = getRandomDelay();
            await sleep(waitTime);
        }
    }

    transporter.close();

    res.write(`data: ${JSON.stringify({ completed: true, total: emails.length, delivered: successCount, failed: failedCount })}\n\n`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
