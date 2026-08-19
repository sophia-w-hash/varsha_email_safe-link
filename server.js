const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Batch Processing Engine
async function processBatchEmails(emailList, subject, htmlBody, userEmail, appPassword) {
    const BATCH_SIZE = 6;
    let successCount = 0;
    let failedCount = 0;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: userEmail,
            pass: appPassword
        },
        pool: true,
        maxConnections: 1
    });

    for (let i = 0; i < emailList.length; i += BATCH_SIZE) {
        const currentBatch = emailList.slice(i, i + BATCH_SIZE);

        const promises = currentBatch.map(async (recipient) => {
            const mailOptions = {
                from: `"Client Support" <${userEmail}>`,
                to: recipient,
                subject: subject,
                html: htmlBody,
                headers: {
                    "X-Priority": "3",
                    "X-MSMail-Priority": "Normal",
                    "Importance": "Normal"
                }
            };

            try {
                await transporter.sendMail(mailOptions);
                console.log(`[SUCCESS] Delivered: ${recipient}`);
                return true;
            } catch (err) {
                console.error(`[FAILED] ${recipient}:`, err.message);
                return false;
            }
        });

        const results = await Promise.all(promises);
        results.forEach(res => res ? successCount++ : failedCount++);

        if (i + BATCH_SIZE < emailList.length) {
            console.log("Waiting 2.5 seconds before next batch...");
            await sleep(2500);
        }
    }

    return { successCount, failedCount };
}

// Direct Text Paste API Endpoint
app.post('/api/send-direct', async (req, res) => {
    const { gmailUser, appPass, emailListText, subject, body } = req.body;

    if (!gmailUser || !appPass) {
        return res.status(400).json({ error: "Gmail User aur App Password zaroori hain." });
    }

    if (!emailListText || emailListText.trim() === '') {
        return res.status(400).json({ error: "Kripya emails paste karein." });
    }

    const cleanPass = appPass.replace(/\s+/g, '');

    // Convert pasted text (comma, newline, space separated) into an array of valid emails
    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        return res.status(400).json({ error: "Koi sahi email ID nahi mili." });
    }

    try {
        const summary = await processBatchEmails(emails, subject, body, gmailUser, cleanPass);
        res.json({ message: "Completed", totalFound: emails.length, details: summary });
    } catch (error) {
        res.status(500).json({ error: "Sending Failed: " + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
