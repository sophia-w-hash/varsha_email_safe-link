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

function checkAndTrackLimit(senderEmail, countToAdd) {
    const now = Date.now();
    const ONE_HOUR = 3600000;

    if (!emailTracker[senderEmail]) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    if (now - emailTracker[senderEmail].startTime > ONE_HOUR) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    if (emailTracker[senderEmail].count + countToAdd > 500) {
        return false;
    }

    return true;
}

// Random delay generator to mimic real human sending speed
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/api/send-direct', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { gmailUser, appPass, emailListText, subject, body } = req.body;

    if (!gmailUser || !appPass) {
        res.write(`data: ${JSON.stringify({ error: "Wrong Password or Credentials ❌" })}\n\n`);
        return res.end();
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');
    const displayName = cleanUser.split('@')[0];

    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        res.write(`data: ${JSON.stringify({ error: "No valid emails found ❌" })}\n\n`);
        return res.end();
    }

    if (!checkAndTrackLimit(cleanUser, emails.length)) {
        res.write(`data: ${JSON.stringify({ error: "Hourly Mail Limit Exceeded ❌" })}\n\n`);
        return res.end();
    }

    // SMTP Transporter Setup with standard single connection pooling
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true,
        maxConnections: 1,
        maxMessages: 100,
        auth: {
            user: cleanUser,
            pass: cleanPass
        }
    });

    try {
        await transporter.verify();
    } catch (authError) {
        res.write(`data: ${JSON.stringify({ error: "Authentication Failed (Wrong Password/App Pass) ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;
    let processedSoFar = 0;

    const isHtmlContent = /<[a-z][\s\S]*>/i.test(body);
    const htmlPayload = isHtmlContent 
        ? body 
        : `<div style="font-family: Arial, sans-serif; font-size: 15px; color: #222222; line-height: 1.6;">${body.replace(/\n/g, '<br>')}</div>`;

    // Strip HTML tags for clean plain text fallback
    const plainTextFallback = body.replace(/<[^>]*>?/gm, '').trim();

    // Sequential Queue execution for Inbox delivery
    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];
        const randomHex = crypto.randomBytes(8).toString('hex');
        const domain = cleanUser.split('@')[1] || 'gmail.com';

        const mailOptions = {
            from: `"${displayName}" <${cleanUser}>`,
            to: recipient,
            subject: subject,
            text: plainTextFallback,
            html: htmlPayload,
            headers: {
                'Message-ID': `<${randomHex}-${Date.now()}@${domain}>`,
                'X-Entity-Ref-ID': `${randomHex}`
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

        // Random Delay between 300ms to 600ms (Crucial for Inbox Landing)
        if (i < emails.length - 1) {
            const delay = Math.floor(Math.random() * 300) + 300;
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
