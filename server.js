const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

app.post('/send-bulk-email', async (req, res) => {
    const { senderName, smtpUser, smtpPass, recipients, subject, bodyText } = req.body;

    if (!smtpUser || !smtpPass || !recipients || !subject || !bodyText) {
        return res.status(400).json({ error: "All fields are required!" });
    }

    const emailList = recipients
        .split('\n')
        .map(e => e.trim())
        .filter(e => e.length > 0);

    let sent = 0;
    let failed = 0;
    const total = emailList.length;

    // Direct Secure SMTP Transport
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // SSL Connection
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });

    // Step 1: Real-time SMTP Check
    try {
        await transporter.verify();
        res.write("[SECURITY] SMTP Authentication Verified Successfully!\n\n");
    } catch (err) {
        res.write(`[SMTP ERROR] Verification Failed: ${err.message}\n`);
        return res.end();
    }

    // Step 2: Safe Inbox Dispatch Loop
    for (let i = 0; i < total; i++) {
        const recipient = emailList[i];
        const rem = total - (sent + failed + 1);

        // Standard RFC Message-ID (Anti-Spam RFC Standard)
        const domain = smtpUser.split('@')[1] || 'gmail.com';
        const uniqueMsgId = `<${crypto.randomBytes(12).toString('hex')}@${domain}>`;

        const mailOptions = {
            from: `"${senderName}" <${smtpUser}>`,
            to: recipient,
            subject: subject,
            text: bodyText, // Plain text for max inbox delivery
            messageId: uniqueMsgId,
            date: new Date()
        };

        try {
            await transporter.sendMail(mailOptions);
            sent++;
            res.write(`[INBOX DISPATCH] Email sent to: ${recipient}\n`);
        } catch (error) {
            failed++;
            res.write(`[FAILED] Error sending to ${recipient}: ${error.message}\n`);
        }

        // Live Log Update for UI Counter
        res.write(`[COUNT_UPDATE] Total:${total} Sent:${sent} Failed:${failed} Rem:${rem}\n`);

        // Natural Human-like Delay (25 to 45 seconds gap)
        if (i < total - 1) {
            const delayTime = Math.floor(Math.random() * (45000 - 25000 + 1)) + 25000;
            res.write(`[WARMUP DELAY] Pausing ${Math.round(delayTime / 1000)}s to protect domain reputation...\n\n`);
            await new Promise(r => setTimeout(r, delayTime));
        }
    }

    res.write("\nCampaign Completed Successfully!");
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
