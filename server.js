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

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true,
        maxConnections: 3,
        auth: {
            user: smtpUser,
            pass: smtpPass
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    res.write(`Starting email delivery process for ${emailList.length} emails...\n\n`);

    for (let i = 0; i < emailList.length; i++) {
        const recipient = emailList[i];
        
        const mailOptions = {
            from: `"Support" <${smtpUser}>`,
            to: recipient,
            subject: subject,
            text: bodyText,
            headers: {
                'X-Mailer': 'NodeMailer System',
                'X-Priority': '3'
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            res.write(`[INBOX DISPATCH] Email sent to: ${recipient}\n`);
        } catch (error) {
            res.write(`[FAILED] Could not send to ${recipient}: ${error.message}\n`);
        }

        // Anti-Spam delay (3 to 6 seconds between each email)
        if (i < emailList.length - 1) {
            const delayTime = Math.floor(Math.random() * 3000) + 3000;
            await new Promise(r => setTimeout(r, delayTime));
        }
    }

    transporter.close();
    res.write("\nAll emails processed successfully!");
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
