const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    paymentIntentId: { type: String, required: true, unique: true },
    group:           { type: String, required: false, trim: true, lowercase: true, default: null },
    amount:          { type: Number, required: true },
    currency:        { type: String, required: true, lowercase: true, trim: true },
    userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userEmail:       { type: String, default: null },
    bookerName:      { type: String, default: null },
    status:          { type: String, enum: ['pending', 'paid', 'failed'], default: 'paid' },
    stripeEvent:     { type: String, default: null }
}, {
    timestamps: true
});

module.exports = mongoose.model('Payment', paymentSchema, 'cal_payments');
