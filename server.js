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

    // Standard Direct SMTP Transporter
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // TLS/SSL connection
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });

    // Step 1: Pre-verify SMTP Auth
    try {
        await transporter.verify();
        res.write("[SYSTEM] SMTP Connection Verified Successfully!\n\n");
    } catch (err) {
        res.write(`[SMTP ERROR] Verification Failed: ${err.message}\n`);
        return res.end();
    }

    // Step 2: Clean Dispatch Loop
    for (let i = 0; i < total; i++) {
        const recipient = emailList[i];
        const rem = total - (sent + failed + 1);

        // Generate RFC compliant Unique Message-ID to prevent duplicate spam classification
        const domain = smtpUser.split('@')[1] || 'gmail.com';
        const uniqueMsgId = `<${crypto.randomBytes(16).toString('hex')}@${domain}>`;

        const mailOptions = {
            from: `"${senderName}" <${smtpUser}>`,
            to: recipient,
            subject: subject,
            text: bodyText, // Clean plain-text body
            messageId: uniqueMsgId,
            date: new Date()
        };

        try {
            await transporter.sendMail(mailOptions);
            sent++;
            res.write(`[SUCCESS] Email sent to: ${recipient}\n`);
        } catch (error) {
            failed++;
            res.write(`[FAILED] Error sending to ${recipient}: ${error.message}\n`);
        }

        // Send UI counters
        res.write(`[COUNT_UPDATE] Total:${total} Sent:${sent} Failed:${failed} Rem:${rem}\n`);

        // Anti-Spam Natural Delay (20 to 40 seconds)
        if (i < total - 1) {
            const delayTime = Math.floor(Math.random() * (40000 - 20000 + 1)) + 20000;
            res.write(`[WAITING] Pausing ${Math.round(delayTime / 1000)}s for natural delivery...\n\n`);
            await new Promise(r => setTimeout(r, delayTime));
        }
    }

    res.write("\nAll emails processed!");
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
