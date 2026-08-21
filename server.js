const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

// Helper for Spintax
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

    // SMTP Verification Step
    try {
        await transporter.verify();
        res.write("[SPAM PROTECT] SMTP Credentials Verified Successfully!\n\n");
    } catch (err) {
        res.write(`[SMTP ERROR] Invalid Gmail or App Password: ${err.message}\n`);
        return res.end();
    }

    for (let i = 0; i < total; i++) {
        const recipient = emailList[i];
        const rem = total - (sent + failed + 1);

        const mailOptions = {
            from: `"${senderName}" <${smtpUser}>`,
            to: recipient,
            subject: parseSpintax(subject),
            text: parseSpintax(bodyText),
            headers: { 'X-Priority': '3' }
        };

        try {
            await transporter.sendMail(mailOptions);
            sent++;
            res.write(`[INBOX DISPATCH] Email sent to: ${recipient}\n`);
        } catch (error) {
            failed++;
            res.write(`[FAILED] Could not send to ${recipient}: ${error.message}\n`);
        }

        // Live Count Update Stream
        res.write(`[COUNT_UPDATE] Total:${total} Sent:${sent} Failed:${failed} Rem:${rem}\n`);

        // Human Warm-Delay (15 to 35 seconds per email for Primary Inbox Landing)
        if (i < total - 1) {
            const delayTime = Math.floor(Math.random() * (35000 - 15000 + 1)) + 15000;
            res.write(`[WARM DELAY] Waiting ${Math.round(delayTime / 1000)}s to prevent Spam filters...\n\n`);
            await new Promise(r => setTimeout(r, delayTime));
        }
    }

    res.write("\nCampaign Completed!");
    res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
