'use strict';
const { mongoose } = require('../db');
// Opaque bearer tokens: the token string itself is stored, never the user's credentials.
const sessionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
  role: { type: String, required: true, enum: ['recruiter', 'interviewer', 'admin', 'candidate'] },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
// MongoDB drops expired sessions on its own; routes also reject an expired token.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('Session', sessionSchema);
