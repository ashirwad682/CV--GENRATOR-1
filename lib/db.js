const mongoose = require('mongoose');

let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cv_builder_db';

    if (cached.conn && mongoose.connection.readyState >= 1) {
        return cached.conn;
    }

    if (!cached.promise) {
        const opts = {
            bufferCommands: false,
            serverSelectionTimeoutMS: 5000,
        };

        cached.promise = mongoose.connect(uri, opts)
            .then((mongooseInstance) => {
                console.log('✅ Connected to MongoDB');
                return mongooseInstance;
            })
            .catch(async (err) => {
                cached.promise = null;
                // If remote failed and not already local, attempt local fallback in dev
                const fallbackUri = 'mongodb://127.0.0.1:27017/cv_builder_db';
                if (uri !== fallbackUri && process.env.NODE_ENV !== 'production') {
                    console.warn('⚠️ Primary MongoDB connection failed. Trying local fallback...');
                    return mongoose.connect(fallbackUri, opts);
                }
                throw err;
            });
    }

    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null;
        throw e;
    }

    return cached.conn;
}

module.exports = connectDB;
