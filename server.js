require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const connectDB = require('./lib/db');
const User = require('./models/User');
const CV = require('./models/CV');
const { authenticateToken, JWT_SECRET } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(cors());

// Database connection middleware for all API requests
app.use('/api', async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error('Database connection error:', err.message);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed. Please ensure MONGODB_URI is configured and IP 0.0.0.0/0 is whitelisted in MongoDB Atlas Network Access.'
        });
    }
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// ==================== AUTH ROUTES ====================

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields (name, email, password).' });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'An account with this email address already exists.' });
        }

        // Create new user (password is automatically hashed in pre-save hook)
        const user = new User({
            name,
            email,
            password
        });
        await user.save();

        // Create token
        const token = jwt.sign(
            { id: user._id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            sameSite: 'lax'
        });

        res.status(201).json({
            success: true,
            message: 'Registration successful!',
            token,
            user: { id: user._id, name: user.name, email: user.email }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ success: false, message: 'Server error during registration.' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Please enter both email and password.' });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        const token = jwt.sign(
            { id: user._id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        });

        res.json({
            success: true,
            message: 'Login successful!',
            token,
            user: { id: user._id, name: user.name, email: user.email }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// Current User Profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching profile.' });
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out successfully.' });
});

// ==================== CV ROUTES (PROTECTED) ====================

// Get all CVs for logged-in user
app.get('/api/cvs', authenticateToken, async (req, res) => {
    try {
        const cvs = await CV.find({ userId: req.user.id }).sort({ updatedAt: -1 });
        res.json({ success: true, count: cvs.length, cvs });
    } catch (err) {
        console.error('Error fetching CVs:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch CVs.' });
    }
});

// Create new CV
app.post('/api/cvs', authenticateToken, async (req, res) => {
    try {
        const { title, content } = req.body;
        const cvTitle = title && title.trim() ? title.trim() : 'My Executive CV';

        const cv = new CV({
            userId: req.user.id,
            title: cvTitle,
            content: content || ''
        });

        await cv.save();

        res.status(201).json({
            success: true,
            message: 'CV created successfully!',
            cv
        });
    } catch (err) {
        console.error('Error creating CV:', err);
        res.status(500).json({ success: false, message: 'Failed to create CV.' });
    }
});

// CV Content Sanitizer to remove duplicate sections and extra page wrappers
function sanitizeCVContent(content) {
    if (!content || typeof content !== 'string') return content || '';

    let clean = content
        .replace(/<div class="sheet-footer-tag[^">]*">[\s\S]*?<\/div>/gi, '')
        .replace(/<div class="page-sheet-extra[^">]*">/gi, '');

    // Deduplicate identical adjacent section headers (e.g. repeated <h2>EDUCATION</h2>)
    clean = clean.replace(/(<h2[^>]*>[\s\S]*?<\/h2>)\s*(?:\s*<h2[^>]*>[\s\S]*?<\/h2>)+/gi, (match) => {
        const firstH2 = match.match(/<h2[^>]*>[\s\S]*?<\/h2>/i);
        return firstH2 ? firstH2[0] : match;
    });

    return clean;
}

// Get single CV by ID (Strict ownership check)
app.get('/api/cvs/:id', authenticateToken, async (req, res) => {
    try {
        const cv = await CV.findById(req.params.id);
        if (!cv) {
            return res.status(404).json({ success: false, message: 'CV not found.' });
        }

        // Authorization check: ensure logged-in user owns this CV
        if (cv.userId.toString() !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied: You do not have permission to view this CV.' });
        }

        // Sanitize content before returning
        if (cv.content) {
            const originalContent = cv.content;
            cv.content = sanitizeCVContent(cv.content);
            if (cv.content !== originalContent) {
                await cv.save();
            }
        }

        res.json({ success: true, cv });
    } catch (err) {
        console.error('Error fetching CV:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch CV.' });
    }
});

// Update CV by ID (Strict ownership check)
app.put('/api/cvs/:id', authenticateToken, async (req, res) => {
    try {
        const cv = await CV.findById(req.params.id);
        if (!cv) {
            return res.status(404).json({ success: false, message: 'CV not found.' });
        }

        if (cv.userId.toString() !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied: You do not have permission to modify this CV.' });
        }

        if (req.body.title !== undefined) cv.title = req.body.title;
        if (req.body.content !== undefined) cv.content = sanitizeCVContent(req.body.content);

        await cv.save();

        res.json({
            success: true,
            message: 'CV saved successfully!',
            cv
        });
    } catch (err) {
        console.error('Error updating CV:', err);
        res.status(500).json({ success: false, message: 'Failed to update CV.' });
    }
});

// Delete CV by ID (Strict ownership check)
app.delete('/api/cvs/:id', authenticateToken, async (req, res) => {
    try {
        const cv = await CV.findById(req.params.id);
        if (!cv) {
            return res.status(404).json({ success: false, message: 'CV not found.' });
        }

        if (cv.userId.toString() !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied: You do not have permission to delete this CV.' });
        }

        await CV.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: 'CV deleted successfully.' });
    } catch (err) {
        console.error('Error deleting CV:', err);
        res.status(500).json({ success: false, message: 'Failed to delete CV.' });
    }
});

// Serve frontend SPA routes
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/SpecialisedCV.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'SpecialisedCV.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server (only when run directly)
if (require.main === module || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`🚀 CV Builder App running on http://localhost:${PORT}`);
    });
}

module.exports = app;
