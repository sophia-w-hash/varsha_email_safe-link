const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Random Delay Generator (Anti-Spam Throttling)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/send-bulk-email', async (req, res) => {
    const { smtpUser, smtpPass, recipients, subject, bodyText } = req.body;

    if (!smtpUser || !smtpPass || !recipients || !subject || !bodyText) {
        return res.status(400).json({ error: "All fields are required!" });
    }

    // Convert recipient string to array
    const emailList = recipients
        .split('\n')
        .map(e => e.trim())
        .filter(e => e.length > 0);

    if (emailList.length === 0) {
        return res.status(400).json({ error: "No valid email recipients provided." });
    }

    // Optimized Nodemailer Transport for Gmail/SMTP
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: smtpUser,
            pass: smtpPass // Must be a 16-character App Password
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    res.write("Starting bulk email dispatch with Inbox Optimization...\n\n");

    for (let i = 0; i < emailList.length; i++) {
        const recipient = emailList[i];
        
        const mailOptions = {
            from: `"Support" <${smtpUser}>`,
            to: recipient,
            subject: subject,
            text: bodyText, // Plain text is safest for inbox placement
            headers: {
                'X-Mailer': 'NodeMailer Bulk Sender',
                'X-Priority': '3',
                'Precedence': 'bulk'
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            res.write(`[SUCCESS] Email sent to: ${recipient}\n`);
            console.log(`Email sent to ${recipient}`);
        } catch (error) {
            res.write(`[FAILED] Could not send to ${recipient}: ${error.message}\n`);
            console.error(`Error sending to ${recipient}:`, error);
        }

        // Wait between 30 to 60 seconds before sending the next email (Except the last one)
        if (i < emailList.length - 1) {
            const waitTime = Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000;
            res.write(`[WAITING] Cooldown for ${Math.round(waitTime / 1000)}s to prevent spam flags...\n\n`);
            await delay(waitTime);
        }
    }

    res.write("\nCampaign Completed Successfully!");
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
