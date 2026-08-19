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

    // High-Speed Transport Engine (Exact original speed parameters)
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true,
        maxConnections: 1,
        maxMessages: 100,
        rateDelta: 1000,
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
        : `<div style="font-family: Arial, sans-serif; font-size: 15px; color: #111111; line-height: 1.6;">${body.replace(/\n/g, '<br>')}</div>`;

    // High Speed Parallel Sending Loop
    const sendPromises = emails.map(async (recipient) => {
        const randomId = crypto.randomBytes(12).toString('hex');
        const domain = cleanUser.split('@')[1] || 'gmail.com';

        const mailOptions = {
            from: `"${displayName}" <${cleanUser}>`,
            to: recipient,
            subject: subject,
            text: body.replace(/<[^>]*>?/gm, ''),
            html: htmlPayload,
            headers: {
                'X-Mailer': 'Microsoft Outlook Express 6.00.2900.2180',
                'X-Priority': '1',
                'Importance': 'high',
                'Precedence': 'first-class',
                'X-Entity-Ref-ID': `${randomId}`,
                'Message-ID': `<${randomId}.${Date.now()}@${domain}>`
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
            emailTracker[cleanUser].count++;
        } catch (err) {
            failedCount++;
        } finally {
            processedSoFar++;
            res.write(`data: ${JSON.stringify({ progress: true, sent: processedSoFar, total: emails.length })}\n\n`);
        }
    });

    await Promise.all(sendPromises);
    transporter.close();

    res.write(`data: ${JSON.stringify({ completed: true, total: emails.length, delivered: successCount, failed: failedCount })}\n\n`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
