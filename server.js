const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

app.post('/send-bulk-email', async (req, res) => {
    const { smtpUser, smtpPass, recipients, subject, bodyText } = req.body;

    if (!smtpUser || !smtpPass || !recipients || !subject || !bodyText) {
        return res.status(400).json({ error: "All fields are required!" });
    }

    const emailList = recipients
        .split('\n')
        .map(e => e.trim())
        .filter(e => e.length > 0);

    if (emailList.length === 0) {
        return res.status(400).json({ error: "No valid email recipients provided." });
    }

    // High Speed Connection Pool Setup
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true,             // Keeps SMTP connection open for speed
        maxConnections: 5,      // Sends up to 5 connections concurrently
        maxMessages: 100,
        auth: {
            user: smtpUser,
            pass: smtpPass      // Must be a 16-character App Password
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    res.write(`Starting speed dispatch for ${emailList.length} emails...\n\n`);

    // Batch Processing: 6 Mails Per Batch
    const BATCH_SIZE = 6;
    for (let i = 0; i < emailList.length; i += BATCH_SIZE) {
        const batch = emailList.slice(i, i + BATCH_SIZE);
        
        const sendPromises = batch.map((recipient) => {
            const mailOptions = {
                from: `"Support" <${smtpUser}>`,
                to: recipient,
                subject: subject,
                text: bodyText, // Plain text avoids spam trigger
                headers: {
                    'X-Mailer': 'NodeMailer Speed Sender',
                    'X-Priority': '3',
                    'Precedence': 'bulk'
                }
            };
            return transporter.sendMail(mailOptions)
                .then(() => `[SUCCESS] Email sent to: ${recipient}`)
                .catch((err) => `[FAILED] Could not send to ${recipient}: ${err.message}`);
        });

        // Parallel Execution for speed
        const results = await Promise.all(sendPromises);
        results.forEach(resMsg => res.write(resMsg + '\n'));

        // Short 1-second delay between batches to reduce instant block risk
        if (i + BATCH_SIZE < emailList.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    transporter.close();
    res.write("\nAll Emails Dispatched!");
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
