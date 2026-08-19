const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Batch Processing Engine
async function processBatchEmails(emailList, subject, htmlBody, userEmail, appPassword) {
    const BATCH_SIZE = 6;
    let successCount = 0;
    let failedCount = 0;

    // Transporter dynamic user input se banega
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: userEmail,
            pass: appPassword
        },
        pool: true,
        maxConnections: 1
    });

    for (let i = 0; i < emailList.length; i += BATCH_SIZE) {
        const currentBatch = emailList.slice(i, i + BATCH_SIZE);

        const promises = currentBatch.map(async (recipient) => {
            const mailOptions = {
                from: `"Client Support" <${userEmail}>`,
                to: recipient,
                subject: subject,
                html: htmlBody,
                headers: {
                    "X-Priority": "3",
                    "X-MSMail-Priority": "Normal",
                    "Importance": "Normal"
                }
            };

            try {
                await transporter.sendMail(mailOptions);
                console.log(`[SUCCESS] Delivered: ${recipient}`);
                return true;
            } catch (err) {
                console.error(`[FAILED] ${recipient}:`, err.message);
                return false;
            }
        });

        const results = await Promise.all(promises);
        results.forEach(res => res ? successCount++ : failedCount++);

        if (i + BATCH_SIZE < emailList.length) {
            console.log("Waiting 2.5 seconds before next batch...");
            await sleep(2500);
        }
    }

    return { successCount, failedCount };
}

// API Route
app.post('/api/send-csv', upload.single('csvFile'), (req, res) => {
    const { gmailUser, appPass, subject, body } = req.body;
    const filePath = req.file?.path;

    if (!gmailUser || !appPass) {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(400).json({ error: "Gmail User aur App Password zaroori hain." });
    }

    if (!filePath) {
        return res.status(400).json({ error: "Kripya CSV file upload karein." });
    }

    const cleanPass = appPass.replace(/\s+/g, '');
    const emails = [];

    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
            const email = row.email || row.Email || row.EMAIL;
            if (email && email.includes('@')) {
                emails.push(email.trim());
            }
        })
        .on('end', async () => {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

            if (emails.length === 0) {
                return res.status(400).json({ error: "CSV me koi 'email' column nahi mila." });
            }

            try {
                const summary = await processBatchEmails(emails, subject, body, gmailUser, cleanPass);
                res.json({ message: "Completed", totalFound: emails.length, details: summary });
            } catch (error) {
                res.status(500).json({ error: "Sending Failed: " + error.message });
            }
        })
        .on('error', (err) => {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            res.status(500).json({ error: "CSV reading error: " + err.message });
        });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
