import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import mongoose from 'mongoose';
import crypto from 'crypto';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

const app = express();
const apiKey = '078fc03a4fca4bbfb9b852bdf080234d';
const apiSecret = 'e247f3052a21459bb31a329ebb2ceeff';

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Connect to MongoDB Atlas
const uri = "mongodb+srv://sarthakjena05:m7MqJULGGBm3ns8a@gatorresearch.g0l2t.mongodb.net/gatorresearch?retryWrites=true&w=majority&appName=GatorResearch";

mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("MongoDB Atlas connected successfully"))
    .catch((err) => {
        console.error("MongoDB connection failed:", err.message);
        process.exit(1);
    });

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    verified: { type: Boolean, default: false },
    verificationToken: { type: String }
});

const User = mongoose.model('User', userSchema);

// Verification transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'gatorresearchtest@gmail.com',
        pass: 'blka fcyl stql uhcr'
    }
});

// HMAC-SHA256
function generateDigest(secret, data) {
    return crypto.createHmac('sha1', secret).update(data).digest('hex');
}


function createRequestURL({ q, timeframe, type, pages }) {
    const scope = 'institution';
    const filters = `q|${q}|scope|${scope}|timeframe|${timeframe}|type|${type}`;
    const digest = generateDigest(apiSecret, filters);
    const baseURL = 'https://www.altmetric.com/explorer/api/research_outputs?';

    const queryParams = new URLSearchParams({
        digest: digest,
        key: apiKey,
        'filter[q]': q,
        'filter[timeframe]': timeframe,
        'filter[type][]': type,
        'filter[scope]': 'institution',
        'filter[order]': 'publication_date',
        'page[number]': 1,
        'page[size]': pages
    });
    return baseURL + queryParams.toString();
}



function getAuthors(data) {
    const authors = {};
    data.forEach((item) => {
        if (item.type === 'author') {
            authors[item.id] = item.attributes.name;
        }
    });
    return authors;
}

function getDepartments(data) {
    const departments = {};
    data.forEach((item) => {
        if (item.type === 'department') {
            departments[item.id] = item.attributes.name;
        }
    });
    return departments;
}

// Routes

// Register
app.post("/register", async (req, res) => {
    const { username, password } = req.body;
    try {
        if (!username || !password) return res.status(400).json({ message: "Username and password are required." });

        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ message: "User already exists. Please log in." });

        const verificationToken = crypto.randomBytes(32).toString('hex');
        const hashPass = await bcrypt.hash(password, 10);

        const newUser = new User({ username, password: hashPass, verificationToken });
        await newUser.save();

        const verificationLink = `http://localhost:5001/verify?token=${verificationToken}`;
        await transporter.sendMail({
            from: 'ResearchGator <gatorresearchtest@gmail.com>',
            to: username,
            subject: 'Verify Your Email',
            text: `Click the link to verify: ${verificationLink}`
        });

        res.json({ message: "User registered successfully" });
    } catch (err) {
        res.status(500).json({ message: "Error registering user" });
    }
});

// Verify Email
app.get("/verify", async (req, res) => {
    try {
        const { token } = req.query;
        const user = await User.findOne({ verificationToken: token });
        if (!user) return res.status(400).send("Invalid or expired token");
        user.verified = true;
        user.verificationToken = null;
        await user.save();
        res.send("Email verified successfully!");
    } catch (err) {
        res.status(500).send("Error verifying email");
    }
});

// Login
app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: "Invalid credentials." });
        }
        if (!user.verified) return res.status(400).json({ message: "Account not verified." });
        const token = jwt.sign({ username }, "secretkey", { expiresIn: "1h" });
        res.json({ token });
    } catch (err) {
        res.status(500).json({ message: "Error logging in" });
    }
});

// Search Route
app.post("/search", async (req, res) => {
    const { major, interests = [], skills = [] } = req.body;
    try {
        const q = `${major} ${interests.join(" ")} ${skills.join(" ")}`.trim();
        const timeframe = '1y';
        const type = 'article';
        const pages = 10;

        const url = createRequestURL({ q, timeframe, type, pages });
        const response = await fetch(url);
        const data = await response.json();

        const authorMap = getAuthors(data.included);
        const departmentMap = getDepartments(data.included);

        const results = data.data.map(item => {
            const title = item.attributes.title || 'N/A';
            const authors = item.relationships['institutional-authors']?.map(a => authorMap[a.id]) || [];
            const departments = item.relationships['institutional-departments']?.map(d => departmentMap[d.id]) || [];
            return { title, authors, departments };
        });

        res.json(results);
    } catch (err) {
        console.error("Error fetching data:", err);
        res.status(500).json({ message: "Error fetching data" });
    }
});

// Start the server
const port = 5001;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
