const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Server-side Tracker for Hourly Limit
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

// Stream Endpoint for Real-Time Counter & Deliverability
app.post('/api/send-direct', async (req, res) => {
    const { gmailUser, appPass, emailListText, subject, body } = req.body;

    if (!gmailUser || !appPass) {
        return res.status(400).json({ error: "Wrong Password ❌" });
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');
    const displayName = cleanUser.split('@')[0];

    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        return res.status(400).json({ error: "No valid emails found ❌" });
    }

    if (!checkAndTrackLimit(cleanUser, emails.length)) {
        return res.status(429).json({ error: "Mail Limit Full ❌" });
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
        return res.status(401).json({ error: "Wrong Password ❌" });
    }

    const BATCH_SIZE = 6;
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        const currentBatch = emails.slice(i, i + BATCH_SIZE);

        const promises = currentBatch.map(async (recipient) => {
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
                return true;
            } catch (err) {
                return false;
            }
        });

        const results = await Promise.all(promises);
        results.forEach(res => {
            if (res) {
                successCount++;
                emailTracker[cleanUser].count++;
            } else {
                failedCount++;
            }
        });

        if (i + BATCH_SIZE < emails.length) {
            await sleep(2500);
        }
    }

    return res.json({
        message: "Mail Send Successful ✅",
        total: emails.length,
        delivered: successCount,
        failed: failedCount
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
