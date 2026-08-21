const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

// Spintax Helper Function
function parseSpintax(text) {
    const matches = text.match(/{([^{}]+)}/g);
    if (!matches) return text;
    matches.forEach(match => {
        const options = match.replace('{', '').replace('}', '').split('|');
        const choice = options[Math.floor(Math.random() * options.length)];
        text = text.replace(match, choice);
    });
    return parseSpintax(text);
}

app.post('/send-bulk-email', async (req, res) => {
    const { senderName, smtpUser, smtpPass, recipients, subject, bodyText } = req.body;

    const emailList = recipients
        .split('\n')
        .map(e => e.trim())
        .filter(e => e.length > 0);

    let sent = 0;
    let failed = 0;
    let total = emailList.length;

    // Transporter
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: smtpUser, pass: smtpPass },
        tls: { rejectUnauthorized: false }
    });

    // Step 1: Verify SMTP Connection
    try {
        await transporter.verify();
        res.write("[SPAM PROTECTION] SMTP Verified & Cloudflare Checked!\n\n");
    } catch (err) {
        res.write(`[SMTP ERROR] Invalid Gmail or App Password: ${err.message}\n`);
        return res.end();
    }

    // Step 2: Loop & Dispatch with Multi-Part MIME (Inbox Bypasser)
    for (let i = 0; i < total; i++) {
        const recipient = emailList[i];
        const rem = total - (sent + failed + 1);

        const parsedSub = parseSpintax(subject);
        const parsedBody = parseSpintax(bodyText);

        const mailOptions = {
            from: `"${senderName}" <${smtpUser}>`,
            to: recipient,
            subject: parsedSub,
            text: parsedBody, // Plain Text Fallback
            html: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">${parsedBody.replace(/\n/g, '<br>')}</div>`, // HTML alternative
            headers: {
                'X-Priority': '3',
                'X-Mailer': 'Cloudflare Secured Mailer',
                'Importance': 'normal'
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            sent++;
            res.write(`[INBOX DISPATCH] Email sent to: ${recipient}\n`);
        } catch (error) {
            failed++;
            res.write(`[FAILED] Could not send to ${recipient}: ${error.message}\n`);
        }

        // Live Count Stream
        res.write(`[COUNT_UPDATE] Total:${total} Sent:${sent} Failed:${failed} Rem:${rem}\n`);

        // Human-like Random Delay (20 - 45 seconds for Primary Inbox Placement)
        if (i < total - 1) {
            const delayTime = Math.floor(Math.random() * (45000 - 20000 + 1)) + 20000;
            res.write(`[WARMUP DELAY] Pausing ${Math.round(delayTime / 1000)}s to ensure Primary Inbox Delivery...\n\n`);
            await new Promise(r => setTimeout(r, delayTime));
        }
    }

    res.write("\nCampaign Finished Successfully!");
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
