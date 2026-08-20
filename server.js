const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/api/send-direct', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { senderName, gmailUser, appPass, subject, body, emailListText } = req.body;

    if (!gmailUser || !appPass) {
        res.write(`data: ${JSON.stringify({ error: "Gmail Address ya App Password missing hai! ❌" })}\n\n`);
        return res.end();
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');
    const cleanSenderName = senderName ? senderName.trim() : cleanUser.split('@')[0];

    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        res.write(`data: ${JSON.stringify({ error: "Koyi valid recipient email nahi mila! ❌" })}\n\n`);
        return res.end();
    }

    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: cleanUser,
            pass: cleanPass
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

    // Strict sanitization: Strip HTML to avoid spam trigger flags
    const cleanBodyText = body.replace(/<[^>]*>?/gm, '').trim();

    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];

        const mailOptions = {
            from: `"${cleanSenderName}" <${cleanUser}>`,
            to: recipient,
            subject: subject,
            text: cleanBodyText
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
        } catch (err) {
            console.error(`Failed to send to ${recipient}:`, err.message);
            failedCount++;
        } finally {
            processedSoFar++;
            res.write(`data: ${JSON.stringify({ progress: true, sent: processedSoFar, total: emails.length })}\n\n`);
        }

        // Safe human delay (8 seconds gap)
        if (i < emails.length - 1) {
            await sleep(8000);
        }
    }

    transporter.close();

    res.write(`data: ${JSON.stringify({ completed: true, total: emails.length, delivered: successCount, failed: failedCount })}\n\n`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
