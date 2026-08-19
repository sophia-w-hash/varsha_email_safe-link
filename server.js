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

function checkAndTrackLimit(senderEmail, countToAdd) {
    const now = Date.now();
    const ONE_HOUR = 3600000;

    if (!emailTracker[senderEmail]) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    if (now - emailTracker[senderEmail].startTime > ONE_HOUR) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    // Gmail App Password Limits (Adjust as per requirement)
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

    // HIGH-SPEED CONNECTION POOL
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true,             // Keeps connection alive for fast delivery
        maxConnections: 10,     // Simultaneous threads for ultra-fast speed
        maxMessages: 100,       // Re-use connection up to 100 emails
        rateDelta: 1000,        // Smooth out delivery
        auth: {
            user: cleanUser,
            pass: cleanPass
        }
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

    // Fast Parallel Dispatch
    const sendPromises = emails.map(async (recipient) => {
        // Unique Message-ID generation to pass spam filters
        const randomId = crypto.randomBytes(12).toString('hex');
        const domain = cleanUser.split('@')[1] || 'gmail.com';

        // Converting plain text body to simple HTML structure for better Inbox placement
        const htmlBody = `
            <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6;">
                ${body.replace(/\n/g, '<br>')}
            </div>
        `;

        const mailOptions = {
            from: `"${displayName}" <${cleanUser}>`,
            to: recipient,
            subject: subject,
            text: body,
            html: htmlBody, // Sending both Text and HTML prevents Spam filtering
            headers: {
                'X-Mailer': 'NodeMailer UltraExpress',
                'X-Priority': '3', // Normal Priority (High priority causes spam triggers)
                'Message-ID': `<${randomId}.${Date.now()}@${domain}>`,
                'List-Unsubscribe': `<mailto:${cleanUser}?subject=unsubscribe>`
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

    transporter.close(); // Clean up connection pool

    res.write(`data: ${JSON.stringify({ completed: true, total: emails.length, delivered: successCount, failed: failedCount })}\n\n`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
