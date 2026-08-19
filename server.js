require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Body Parsers & Static Files
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Upload directory setup
const upload = multer({ dest: 'uploads/' });

// Gmail Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASS
    },
    pool: true,
    maxConnections: 1
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Batch Sending Logic (6 Emails Per Batch)
async function processBatchEmails(emailList, subject, htmlBody) {
    const BATCH_SIZE = 6;
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < emailList.length; i += BATCH_SIZE) {
        const currentBatch = emailList.slice(i, i + BATCH_SIZE);

        const promises = currentBatch.map(async (recipient) => {
            const mailOptions = {
                from: `"Marketing Team" <${process.env.GMAIL_USER}>`,
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
                console.log(`[SUCCESS] Delivered to: ${recipient}`);
                return true;
            } catch (err) {
                console.error(`[FAILED] To ${recipient}:`, err.message);
                return false;
            }
        });

        const results = await Promise.all(promises);
        results.forEach(res => res ? successCount++ : failedCount++);

        // Batch ke baad 2.5 seconds ka delay
        if (i + BATCH_SIZE < emailList.length) {
            console.log("Waiting 2.5 seconds before next batch...");
            await sleep(2500);
        }
    }

    return { successCount, failedCount };
}

// Route 1: Direct JSON List Se Mail Bhejne Ke Liye
app.post('/api/send-direct', async (req, res) => {
    const { emails, subject, body } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: "Email array required." });
    }

    const summary = await processBatchEmails(emails, subject, body);
    res.json({ message: "Completed", details: summary });
});

// Route 2: CSV File Upload Karke Mail Bhejne Ke Liye
app.post('/api/send-csv', upload.single('csvFile'), (req, res) => {
    const { subject, body } = req.body;
    const filePath = req.file?.path;

    if (!filePath) {
        return res.status(400).json({ error: "Please upload a CSV file." });
    }

    const emails = [];

    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
            // CSV me column ka naam 'email' hona chahiye
            const email = row.email || row.Email || row.EMAIL;
            if (email && email.includes('@')) {
                emails.push(email.trim());
            }
        })
        .on('end', async () => {
            // Delete temp file
            fs.unlinkSync(filePath);

            if (emails.length === 0) {
                return res.status(400).json({ error: "No valid email column found in CSV." });
            }

            const summary = await processBatchEmails(emails, subject, body);
            res.json({ message: "CSV Batch Processing Completed", totalFound: emails.length, details: summary });
        })
        .on('error', (err) => {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            res.status(500).json({ error: "CSV parsing failed: " + err.message });
        });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
