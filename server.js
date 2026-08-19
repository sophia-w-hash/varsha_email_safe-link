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

// Generate unique plain-text version from HTML
function convertToPlainText(html) {
    if (!html) return '';
    return html
        .replace(/<br\s*[\/]?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]*>/g, '')
        .trim();
}

app.post('/api/send-direct', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { gmailUser, appPass, emailListText, subject, body } = req.body;

    if (!gmailUser || !appPass) {
        res.write(`data: ${JSON.stringify({ error: "Gmail Address ya App Password missing hai! ❌" })}\n\n`);
        return res.end();
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');
    const senderDomain = cleanUser.split('@')[1] || 'gmail.com';
    const senderName = cleanUser.split('@')[0];

    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        res.write(`data: ${JSON.stringify({ error: "Koyi valid recipient email nahi mila! ❌" })}\n\n`);
        return res.end();
    }

    // High Trust Pool Connection
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // TLS Start
        requireTLS: true,
        auth: {
            user: cleanUser,
            pass: cleanPass
        },
        tls: {
            ciphers: 'SSLv3'
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

    const isHtml = /<[a-z][\s\S]*>/i.test(body);

    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];
        const recipientDomain = recipient.split('@')[1] || 'client.com';
        const uniqueToken = crypto.randomBytes(8).toString('hex');
        
        // Zero-Width space injection to avoid hash-matching spam filters across external recipients
        const zeroWidthSpace = '\u200B';
        const randomizedBody = body + zeroWidthSpace.repeat(Math.floor(Math.random() * 5) + 1);

        const htmlContent = isHtml 
            ? randomizedBody 
            : `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; color: #1f2937; line-height: 1.6;">${randomizedBody.replace(/\n/g, '<br>')}</div>`;

        const plainTextContent = convertToPlainText(randomizedBody);

        const mailOptions = {
            from: `"${senderName}" <${cleanUser}>`,
            to: recipient,
            subject: subject,
            text: plainTextContent,
            html: htmlContent,
            headers: {
                // High deliverability headers for external clients
                'Message-ID': `<${uniqueToken}-${Date.now()}@${senderDomain}>`,
                'X-Mailer': 'Outlook-Express/7.0 (MSN 10.0)',
                'X-Priority': '3',
                'X-MSMail-Priority': 'Normal',
                'List-Unsubscribe': `<mailto:${cleanUser}?subject=Unsubscribe-${uniqueToken}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                'X-Complaints-To': `mailto:abuse@${senderDomain}`
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
        } catch (err) {
            console.error(`Failed delivery to ${recipient}:`, err.message);
            failedCount++;
        } finally {
            processedSoFar++;
            res.write(`data: ${JSON.stringify({ progress: true, sent: processedSoFar, total: emails.length })}\n\n`);
        }

        // Delay algorithm: 500ms - 1000ms delay per client email
        if (i < emails.length - 1) {
            const delay = Math.floor(Math.random() * 500) + 500;
            await sleep(delay);
        }
    }

    transporter.close();

    res.write(`data: ${JSON.stringify({ completed: true, total: emails.length, delivered: successCount, failed: failedCount })}\n\n`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
