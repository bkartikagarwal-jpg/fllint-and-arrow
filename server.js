const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to read form data and serve static website files
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname)); // Serves your index.html, style.css, etc.

// Route to handle form submission
app.post('/submit-form', (req, res) => {
    const { name, email, message } = req.body;
    
    const newEntry = {
        date: new Date().toISOString(),
        name,
        email,
        message
    };

    const filePath = path.join(__dirname, 'messages.json');

    // Read existing messages or start with an empty array
    fs.readFile(filePath, 'utf8', (err, data) => {
        let messages = [];
        if (!err && data) {
            try {
                messages = JSON.parse(data);
            } catch (e) {
                messages = [];
            }
        }

        // Add the new message entry to our list
        messages.push(newEntry);

        // Save the updated list back into the JSON file
        fs.writeFile(filePath, JSON.stringify(messages, null, 2), (writeErr) => {
            if (writeErr) {
                console.error(writeErr);
                return res.status(500).send('Error saving message.');
            }
            // Change this redirect URL to wherever your "Thank You" page is
            res.send('<h1>Thank you! Your message has been saved to messages.json.</h1><a href="/">Go Back</a>');
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
