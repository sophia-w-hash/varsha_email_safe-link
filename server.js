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

// Human delay: 8 to 15 seconds random gap between emails
const getRandomDelay = () => Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000;
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

    // Safety limit per hour for standard Gmail
    if (emailTracker[senderEmail].count + countToAdd > 30) {
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
        res.write(`data: ${JSON.stringify({ error: "Missing Email or App Password ❌" })}\n\n`);
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
        res.write(`data: ${JSON.stringify({ error: "No valid recipients found ❌" })}\n\n`);
        return res.end();
    }

    if (!checkAndTrackLimit(cleanUser, emails.length)) {
        res.write(`data: ${JSON.stringify({ error: "Hourly Safe Limit Reached (Max 30/hr for Inbox Placement) ❌" })}\n\n`);
        return res.end();
    }

    // High Trust Connection Setup
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: cleanUser,
            pass: cleanPass
        }
    });

    try {
        await transporter.verify();
    } catch (authError) {
        res.write(`data: ${JSON.stringify({ error: "Authentication Failed! Check App Password. ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;
    let processedSoFar = 0;

    // Remove raw tags for clean plain text rendering
    const plainTextBody = body.replace(/<[^>]*>?/gm, '').trim();

    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];

        // Unique RFC Compliant ID generation to bypass duplicate detectors
        const domain = cleanUser.split('@')[1] || 'gmail.com';
        const uniqueMsgId = `<${crypto.randomBytes(8).toString('hex')}.${Date.now()}@${domain}>`;

        const mailOptions = {
            from: `"${cleanSenderName}" <${cleanUser}>`,
            to: recipient,
            subject: subject,
            text: plainTextBody,
            // Clean inline HTML format for Primary Tab inboxing
            html: `
                <div style="font-family: Arial, sans-serif; font-size: 14px; color: #111111; line-height: 1.6;">
                    ${plainTextBody.replace(/\n/g, '<br>')}
                </div>
            `,
            headers: {
                'Message-ID': uniqueMsgId,
                'X-Mailer': 'Thunderbird/115.0',
                'X-Priority': '3 (Normal)'
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

        // Apply natural randomized human delay
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
