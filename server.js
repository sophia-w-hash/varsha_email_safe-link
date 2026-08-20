const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/api/send-direct', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { gmailUser, appPass, emailListText, subject, body, footerLink, imageUrl } = req.body;

    if (!gmailUser || !appPass) {
        res.write(`data: ${JSON.stringify({ error: "Gmail ya App Password missing hai! ❌" })}\n\n`);
        return res.end();
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');
    const senderName = cleanUser.split('@')[0];

    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        res.write(`data: ${JSON.stringify({ error: "Koyi valid recipient email nahi mila! ❌" })}\n\n`);
        return res.end();
    }

    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: cleanUser,
            pass: cleanPass
        }
    });

    try {
        await transporter.verify();
    } catch (authError) {
        res.write(`data: ${JSON.stringify({ error: "SMTP Authentication Failed! App Password check karein. ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;
    let processedSoFar = 0;

    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];

        // Safe Footer Construction
        let footerHtml = '';
        if (imageUrl || footerLink) {
            footerHtml = `
                <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
                    ${imageUrl ? `<img src="${imageUrl}" alt="Footer Banner" style="max-width: 100%; height: auto; border-radius: 6px; margin-bottom: 10px;"><br>` : ''}
                    ${footerLink ? `<a href="${footerLink}" style="color: #2563eb; text-decoration: underline;" target="_blank">Visit Official Link</a>` : ''}
                </div>
            `;
        }

        const fullHtml = `
            <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1f2937; line-height: 1.6;">
                <div>${body.replace(/\n/g, '<br>')}</div>
                ${footerHtml}
            </div>
        `;

        const mailOptions = {
            from: `"${senderName}" <${cleanUser}>`,
            to: recipient,
            subject: subject,
            html: fullHtml
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
        } catch (err) {
            failedCount++;
        } finally {
            processedSoFar++;
            res.write(`data: ${JSON.stringify({ progress: true, sent: processedSoFar, total: emails.length })}\n\n`);
        }

        // Safety Delay (5 Seconds)
        if (i < emails.length - 1) {
            await sleep(5000);
        }
    }

    transporter.close();

    res.write(`data: ${JSON.stringify({ completed: true, total: emails.length, delivered: successCount, failed: failedCount })}\n\n`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
