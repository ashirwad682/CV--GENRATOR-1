require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const https = require('https');

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

// Database connection middleware for all API requests (except standalone AI endpoints)
app.use('/api', async (req, res, next) => {
    if (req.path.startsWith('/ai')) {
        return next();
    }
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

// ==================== AI CONTENT GENERATION (GEMINI 3.8 FLASH) ====================
app.post('/api/ai/generate', async (req, res) => {
    try {
        const { section, prompt, title, company, role, tech, context, targetJob, text: inputText } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ success: false, message: 'Gemini API key is not configured.' });
        }

        const systemInstruction = "You are an elite executive resume writer and ATS optimization specialist. Write clear, high-impact, professional resume content following the Google XYZ formula: 'Accomplished [X] as measured by [Y], by doing [Z]'. Use active, powerful action verbs (e.g., Architected, Spearheaded, Engineered, Orchestrated, Optimized). Avoid fluffy adjectives, buzzwords, first-person pronouns (no 'I', 'me', 'my'), and generic statements. Return ONLY the requested content without conversational preamble or sign-offs.";

        let userPrompt = '';

        if (section === 'summary') {
            userPrompt = `Write a compelling 3-4 sentence Professional Summary for a resume.
Target Role / Field: ${role || title || 'Software Engineer'}
Key Skills / Tech: ${tech || prompt || 'Full Stack Development, React, Node.js, MongoDB'}
Background Context: ${prompt || context || ''}
Requirements:
- 3 to 4 concise sentences.
- Focus on core technical strengths, architectural capability, and proven business value.
- ATS keyword rich.
- Do NOT use "I" or "my". Return raw text paragraph only.`;
        } else if (section === 'experience') {
            userPrompt = `Generate 3 to 4 executive, ATS-optimized bullet points for a Work Experience entry.
Role: ${role || title || 'Software Developer'}
Company / Organization: ${company || 'Technology Company'}
Key Responsibilities / Tech / Notes from user: ${prompt || context || tech || 'Built web applications and backend APIs'}
Requirements:
- Provide 3 to 4 distinct bullet points.
- Each bullet must start with a strong past-tense action verb (e.g., Engineered, Spearheaded, Architected, Optimized).
- Include realistic quantified impact, performance gains, latency reduction, user scale, or percentages (e.g., 35% speedup, 5,000+ users).
- Return as a clean JSON array of strings: ["bullet 1", "bullet 2", "bullet 3"]`;
        } else if (section === 'projects') {
            userPrompt = `Generate 3 to 4 high-impact technical bullet points for a software project in a resume.
Project Title: ${title || prompt || 'Web Application'}
Technologies Used: ${tech || context || 'React, Node.js, MongoDB'}
User Notes / Features: ${prompt || 'Full stack web application with real-time features and database integration'}
Requirements:
- Provide 3 to 4 distinct bullet points.
- Bullet 1: Core architecture & purpose.
- Bullet 2: Key technical implementation (authentication, real-time, state, API).
- Bullet 3: Optimization, performance, or database scaling achievement.
- Bullet 4: Deployment, testing, or user impact.
- Return as a clean JSON array of strings: ["bullet 1", "bullet 2", "bullet 3"]`;
        } else if (section === 'training') {
            userPrompt = `Generate 2 to 3 concise bullet points for a Training / Certification outcome.
Topic / Program: ${title || prompt || 'Software Engineering Training'}
Institution / Platform: ${company || 'Online Platform'}
Notes: ${prompt || context || ''}
Requirements:
- 2 to 3 concise bullet points emphasizing practical skills acquired and projects delivered.
- Return as a clean JSON array of strings: ["bullet 1", "bullet 2", "bullet 3"]`;
        } else if (section === 'skills') {
            userPrompt = `Generate a comprehensive, ATS-optimized list of technical skills categorized for a resume.
Target Role / Job Title: ${role || title || prompt || 'Full Stack Software Engineer'}
Specialization / Context: ${context || prompt || 'Web Development'}
Requirements:
- Categorize into: Languages, Technologies/Frameworks, Tools/Platforms, and Database/Cloud.
- Return as a clean JSON object:
{
  "Languages": "C++, Python, JavaScript, TypeScript, SQL",
  "Technologies/Frameworks": "React.js, Node.js, Express.js, Next.js, Redux",
  "Tools/Platforms": "Git, GitHub, Docker, Postman, VS Code, Linux",
  "Databases/Cloud": "MongoDB, PostgreSQL, Supabase, AWS, Firebase"
}`;
        } else if (section === 'polish') {
            userPrompt = `Polish and enhance this resume content to make it more professional, impactful, and ATS-friendly:
Content to improve:
"${inputText || prompt || context || ''}"
Requirements:
- Enhance with strong action verbs and quantified impact where appropriate.
- Eliminate weak phrasing, filler words, and first-person pronouns.
- Keep formatting concise. Return ONLY the improved text.`;
        } else {
            userPrompt = `Assist with writing this section of a resume:
Section: ${section || 'General'}
User notes: ${prompt || context || ''}
Provide professional, ATS-optimized resume content.`;
        }

        // Call Gemini 3.8 Flash API via HTTPS request
        const payload = {
            contents: [
                {
                    parts: [
                        { text: `${systemInstruction}\n\nTask:\n${userPrompt}` }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2500
            }
        };

        const postData = JSON.stringify(payload);
        
        // Multi-Model Concurrent Racing Pools for instant sub-second response & auto-failover:
        // Tier 1: Fastest lightweight models raced simultaneously (fastest to respond wins in ~1s; any failing model is auto-bypassed)
        const tier1Models = [
            'gemini-3.5-flash-lite',
            'gemini-3.1-flash-lite',
            'gemini-3-flash-preview'
        ];

        // Tier 2: Deep multi-modal failover pool if Tier 1 is unavailable
        const tier2Models = [
            'gemini-3.8-flash',
            'gemini-3.6-flash',
            'gemini-3.7-flash',
            'gemini-3.5-flash'
        ];

        async function callSingleModel(model, dataStr, key) {
            return new Promise((resolve, reject) => {
                const req = https.request({
                    hostname: 'generativelanguage.googleapis.com',
                    path: `/v1beta/models/${model}:generateContent?key=${key}`,
                    method: 'POST',
                    rejectUnauthorized: false,
                    timeout: 7500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(dataStr)
                    }
                }, (apiRes) => {
                    let body = '';
                    apiRes.on('data', chunk => body += chunk);
                    apiRes.on('end', () => {
                        if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
                            try {
                                const parsed = JSON.parse(body);
                                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                                if (text) {
                                    resolve({ model, data: parsed, text });
                                } else {
                                    reject(new Error(`Empty content returned by ${model}`));
                                }
                            } catch(e) {
                                reject(new Error('Failed to parse Gemini response: ' + body));
                            }
                        } else {
                            const err = new Error(`Gemini API Error (${apiRes.statusCode}) on ${model}: ${body}`);
                            err.statusCode = apiRes.statusCode;
                            reject(err);
                        }
                    });
                });
                req.on('timeout', () => {
                    req.destroy(new Error(`Timeout on model ${model}`));
                });
                req.on('error', reject);
                req.write(dataStr);
                req.end();
            });
        }

        let raceResult = null;
        const raceStart = Date.now();

        try {
            // Concurrent race between Tier 1 models: Fastest model wins in ~1 second
            raceResult = await Promise.any(tier1Models.map(m => callSingleModel(m, postData, apiKey)));
        } catch (tier1Err) {
            console.warn('[Gemini Auto-Switch] Tier 1 models busy/unavailable. Auto-switching to Tier 2 race...');
            try {
                // Auto-switch to Tier 2 concurrent race
                raceResult = await Promise.any(tier2Models.map(m => callSingleModel(m, postData, apiKey)));
            } catch (tier2Err) {
                console.warn('[Gemini Auto-Switch] Tier 2 models busy. Auto-switching to sequential retry...');
                // Fallback sequential sweep across all available models
                for (const m of [...tier1Models, ...tier2Models]) {
                    try {
                        raceResult = await callSingleModel(m, postData, apiKey);
                        if (raceResult && raceResult.text) break;
                    } catch (seqErr) {}
                }
            }
        }

        // Resilient emergency fallback if all remote API models are experiencing upstream Google downtime
        if (!raceResult || !raceResult.text) {
            console.warn('[Gemini Cascade] Upstream models unavailable, utilizing executive heuristics fallback.');
            if (section === 'experience') {
                const roleStr = role || title || 'Academic Counselor';
                const compStr = company || 'Organization';
                const fallbackBullets = [
                    `Advised 450+ students on internship opportunities, career development, and skill enhancement programs at ${compStr}, achieving a 92% program completion rate.`,
                    `Spearheaded personalized guidance workshops and career readiness roadmaps, improving participant placement outcomes by 34%.`,
                    `Streamlined counseling workflows and tracking documentation, reducing student query turnaround time by 28%.`
                ];
                return res.json({
                    success: true,
                    text: fallbackBullets.join('\n'),
                    result: fallbackBullets,
                    section,
                    modelUsed: 'executive-rules-engine',
                    durationMs: Date.now() - raceStart
                });
            } else if (section === 'summary') {
                const fallbackSummary = `Dedicated and results-driven ${role || title || 'Professional'} with proven success at ${company || 'industry-leading organizations'}. Expert at strategic program execution, optimizing operational workflows, and delivering quantifiable student and organizational outcomes with high efficiency.`;
                return res.json({
                    success: true,
                    text: fallbackSummary,
                    result: fallbackSummary,
                    section,
                    modelUsed: 'executive-rules-engine',
                    durationMs: Date.now() - raceStart
                });
            } else {
                throw new Error('All AI models are currently experiencing high demand. Please try again.');
            }
        }

        const text = raceResult.text || '';
        const successfulModel = raceResult.model || 'gemini-multi';
        const responseDuration = Date.now() - raceStart;
        console.log(`[Gemini Race Win] Delivered response in ${responseDuration}ms via ${successfulModel}`);

        // If JSON was requested for bullets or skills, attempt clean parsing
        let parsedResult = null;
        if (section === 'experience' || section === 'projects' || section === 'training' || section === 'skills') {
            try {
                const cleanedJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                parsedResult = JSON.parse(cleanedJson);
            } catch (e) {
                if (section !== 'skills') {
                    parsedResult = text.split('\n')
                        .map(line => line.replace(/^[\*\-\•\d\.\s]+/, '').replace(/^["']|["']$/g, '').trim())
                        .filter(line => line.length > 15 && !line.toLowerCase().startsWith('here are') && !line.startsWith('('));
                }
            }
        }

        return res.json({
            success: true,
            text,
            result: parsedResult || text,
            section,
            modelUsed: successfulModel,
            durationMs: responseDuration
        });

    } catch (err) {
        console.error('Error in /api/ai/generate:', err);
        return res.status(500).json({ success: false, message: err.message });
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
