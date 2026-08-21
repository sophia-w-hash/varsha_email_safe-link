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

    if (!smtpUser || !smtpPass || !recipients || !subject || !bodyText) {
        return res.status(400).json({ error: "Sabhi fields mandatory hain." });
    }

    const emailList = recipients
        .split('\n')
        .map(e => e.trim())
        .filter(e => e.length > 0);

    let sent = 0;
    let failed = 0;
    const total = emailList.length;

    // Direct Transporter Setup
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // SSL security
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });

    // Step 1: Verify SMTP Connection
    try {
        await transporter.verify();
        res.write("SMTP Connection Successfully Verified.\n\n");
    } catch (err) {
        res.write(`[SMTP Authentication Error]: ${err.message}\n`);
        return res.end();
    }

    // Step 2: Sequential Sending
    for (let i = 0; i < total; i++) {
        const recipient = emailList[i];
        const rem = total - (sent + failed + 1);

        const mailOptions = {
            from: `"${senderName}" <${smtpUser}>`,
            to: recipient,
            subject: subject,
            text: bodyText, // Plain text content
        };

        try {
            await transporter.sendMail(mailOptions);
            sent++;
            res.write(`[SENT] Email delivered to: ${recipient}\n`);
        } catch (error) {
            failed++;
            res.write(`[FAILED] Error for ${recipient}: ${error.message}\n`);
        }

        // Live Log Updates for Frontend UI
        res.write(`[COUNT_UPDATE] Total:${total} Sent:${sent} Failed:${failed} Rem:${rem}\n`);

        // Sending Delay (Randomized gap between messages)
        if (i < total - 1) {
            const delayTime = Math.floor(Math.random() * 5000) + 5000; // 5-10 second delay
            await new Promise(r => setTimeout(r, delayTime));
        }
    }

    res.write("\nAll emails processed.");
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
