const mongoose = require('mongoose');

const cvSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: [true, 'CV title is required'],
        trim: true,
        default: 'Untitled CV'
    },
    content: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('CV', cvSchema);
