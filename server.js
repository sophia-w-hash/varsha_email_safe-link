const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

app.post('/send-bulk-email', async (req, res) => {
    const { senderName, smtpUser, smtpPass, recipients, subject, bodyText } = req.body;

    if (!senderName || !smtpUser || !smtpPass || !recipients || !subject || !bodyText) {
        return res.status(400).json({ error: "All fields are required!" });
    }

    const emailList = recipients
        .split('\n')
        .map(e => e.trim())
        .filter(e => e.length > 0);

    let sent = 0;
    let failed = 0;
    const total = emailList.length;

    // Standard Gmail Transporter
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });

    // Step 1: SMTP Connection Check
    try {
        await transporter.verify();
        res.write("[STATUS] SMTP Connection Successful.\n\n");
    } catch (err) {
        res.write(`[ERROR] Invalid Credentials: ${err.message}\n`);
        return res.end();
    }

    // Step 2: Clean Sequential Sending
    for (let i = 0; i < total; i++) {
        const recipient = emailList[i];
        const rem = total - (sent + failed + 1);

        const mailOptions = {
            from: `"${senderName}" <${smtpUser}>`,
            to: recipient,
            subject: subject,
            text: bodyText // Pure plain text (Safest)
        };

        try {
            await transporter.sendMail(mailOptions);
            sent++;
            res.write(`[SUCCESS] Email sent to: ${recipient}\n`);
        } catch (error) {
            failed++;
            res.write(`[FAILED] Error for ${recipient}: ${error.message}\n`);
        }

        // Live Log Update
        res.write(`[COUNT_UPDATE] Total:${total} Sent:${sent} Failed:${failed} Rem:${rem}\n`);

        // Natural Sending Delay (25 to 40 Seconds)
        if (i < total - 1) {
            const delayTime = Math.floor(Math.random() * (40000 - 25000 + 1)) + 25000;
            res.write(`[WAITING] Delay for ${Math.round(delayTime / 1000)}s...\n\n`);
            await new Promise(r => setTimeout(r, delayTime));
        }
    }

    res.write("\nProcess Completed.");
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
