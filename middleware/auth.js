const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'cv_builder_super_secret_jwt_key_2026';

const authenticateToken = (req, res, next) => {
    let token = null;

    // Check auth header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access denied. No authentication token provided.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
};

module.exports = { authenticateToken, JWT_SECRET };
