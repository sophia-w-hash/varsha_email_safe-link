const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Tracker for Per-Email Hourly Limit (1 Email ID = 28 Mails / 1 Hour)
const emailTracker = {};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function checkAndTrackLimit(senderEmail, countToAdd) {
    const now = Date.now();
    const ONE_HOUR = 3600000;

    if (!emailTracker[senderEmail]) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    // Reset counter if 1 hour has passed
    if (now - emailTracker[senderEmail].startTime > ONE_HOUR) {
        emailTracker[senderEmail] = { count: 0, startTime: now };
    }

    if (emailTracker[senderEmail].count + countToAdd > 28) {
        return false; // Limit exceeded
    }

    return true;
}

// API Endpoint
app.post('/api/send-direct', async (req, res) => {
    const { gmailUser, appPass, emailListText, subject, body } = req.body;

    if (!gmailUser || !appPass) {
        return res.status(400).json({ error: "Wrong Password ❌" });
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');

    // Extract Display Name from email (e.g. gdduksih@gmail.com -> gdduksih)
    const displayName = cleanUser.split('@')[0];

    // Convert email string into array
    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        return res.status(400).json({ error: "No valid emails found ❌" });
    }

    // Check Per-Email Rate Limit
    if (!checkAndTrackLimit(cleanUser, emails.length)) {
        return res.status(429).json({ error: "Mail Limit Full ❌" });
    }

    // Transporter
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: cleanUser,
            pass: cleanPass
        },
        pool: true,
        maxConnections: 1
    });

    // Verify Password Credentials first
    try {
        await transporter.verify();
    } catch (authError) {
        return res.status(401).json({ error: "Wrong Password ❌" });
    }

    const BATCH_SIZE = 6;
    let successCount = 0;
    let failedCount = 0;

    // Plain-text formatted body preserving exact newline structure
    const formattedTextBody = body;

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        const currentBatch = emails.slice(i, i + BATCH_SIZE);

        const promises = currentBatch.map(async (recipient) => {
            const mailOptions = {
                from: `"${displayName}" <${cleanUser}>`,
                to: recipient,
                subject: subject,
                text: formattedTextBody, // Plain text for max inbox deliverability
                headers: {
                    "X-Priority": "3",
                    "X-MSMail-Priority": "Normal",
                    "Importance": "Normal"
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
