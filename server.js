const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Speed: 1 to 2 Seconds Delay
const getFastDelay = () => Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;

// Dynamic Spintax Parser
function parseSpintax(text) {
    if (!text) return '';
    return text.replace(/\{([^{}]+)\}/g, (match, choices) => {
        const options = choices.split('|');
        return options[Math.floor(Math.random() * options.length)].trim();
    });
}

app.post('/api/send-direct', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { senderName, gmailUser, appPass, emailListText, subject, body } = req.body;

    if (!gmailUser || !appPass) {
        res.write(`data: ${JSON.stringify({ error: "Gmail ID ya App Password missing hai! ❌" })}\n\n`);
        return res.end();
    }

    const cleanUser = gmailUser.trim().toLowerCase();
    const cleanPass = appPass.replace(/\s+/g, '');
    const cleanSenderName = senderName ? senderName.trim() : cleanUser.split('@')[0];

    const emails = emailListText
        .split(/[\n,\s]+/)
        .map(e => e.trim())
        .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
        res.write(`data: ${JSON.stringify({ error: "Koi valid email address nahi mila! ❌" })}\n\n`);
        return res.end();
    }

    // Optimized Single-Connection Transport for High-Speed Delivery
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
        res.write(`data: ${JSON.stringify({ error: "Authentication Failed! App Password check karein. ❌" })}\n\n`);
        return res.end();
    }

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < emails.length; i++) {
        const recipient = emails[i];

        // Unique dynamic content per recipient
        const dynamicSubject = parseSpintax(subject);
        const dynamicBody = parseSpintax(body);

        // Generate Human-like RFC Compliant Message-ID
        const domain = cleanUser.split('@')[1] || 'gmail.com';
        const uniqueMsgId = `<${crypto.randomBytes(8).toString('hex')}.${Date.now()}@${domain}>`;

        // HIGH-TRUST PLAIN TEXT CONFIGURATION
        const mailOptions = {
            from: `"${cleanSenderName}" <${cleanUser}>`,
            to: recipient,
            replyTo: cleanUser,
            subject: dynamicSubject,
            text: dynamicBody, // Pure Plain Text (No HTML)
            headers: {
                'Message-ID': uniqueMsgId,
                'X-Mailer': 'iPhone Mail (20G81)', // Emulate iPhone Client
                'X-Priority': '3',
                'MIME-Version': '1.0'
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
        } catch (err) {
            console.error(`Failed delivery to ${recipient}:`, err.message);
            failedCount++;
        }

        res.write(`data: ${JSON.stringify({ progress: true, sent: i + 1, total: emails.length })}\n\n`);

        // 1 to 2 Seconds Speed Delay
        if (i < emails.length - 1) {
            await sleep(getFastDelay());
        }
    }

    transporter.close();
    res.write(`data: ${JSON.stringify({ completed: true, total: emails.length, delivered: successCount, failed: failedCount })}\n\n`);
    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
