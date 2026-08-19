const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const emailTracker = {};
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

    if (emailTracker[senderEmail].count + countToAdd > 28) {
        return false;
    }

    return true;
}

// Single-Email Level LIVE Stream Endpoint
app.post('/api/send-direct', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { gmailUser, appPass, emailListText, subject, body } = req.body;

    if (!gmailUser || !appPass) {
        res.write(`data: ${JSON.stringify({ error: "Wrong Password ❌" })}\n\n`);
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
        res.write(`data: ${JSON.stringify({ error: "Mail Limit Full ❌" })}\n\n`);
        return res.end();
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: cleanUser,
            pass: cleanPass
        },
        pool: true,
        maxConnections: 1
    });

    try {
        await transporter.verify();
    } catch (authError) {
        res.write(`data: ${JSON.stringify({ error: "Wrong Password ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;
    let processedSoFar = 0;

    // Loop through emails individually to stream live 1-by-1 increments
    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];
        const randomMsgId = `<${crypto.randomBytes(16).toString('hex')}@gmail.com>`;
        
        const mailOptions = {
            from: `"${displayName}" <${cleanUser}>`,
            to: recipient,
            subject: subject,
            text: body,
            headers: {
                "X-Priority": "3",
                "X-MSMail-Priority": "Normal",
                "Importance": "Normal",
                "Message-ID": randomMsgId,
                "List-Unsubscribe": `<mailto:${cleanUser}?subject=unsubscribe>`
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
            emailTracker[cleanUser].count++;
        } catch (err) {
            failedCount++;
        }

        processedSoFar++;

        // Send instant SSE event after each single email
        res.write(`data: ${JSON.stringify({ progress: true, sent: processedSoFar, total: emails.length })}\n\n`);

        // Natural delay between sends for high inbox delivery
        await sleep(600);
    }

    res.write(`data: ${JSON.stringify({ completed: true, total: emails.length, delivered: successCount, failed: failedCount })}\n\n`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
