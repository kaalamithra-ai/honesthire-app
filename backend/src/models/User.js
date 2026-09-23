'use strict';
const { mongoose } = require('../db');
// Member who logs in. Roles drive UI + API authorization (see backend/src/auth.js).
//   admin    - recruiting admin: full dashboard + audit/team management.
//   recruiter / interviewer - "Employee": candidate feed, interviews & pipeline.
//   candidate - external applicant: a personal portal over their own record.
// candidateId links a candidate-role user back to their own Candidate document.
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 200 },
  role: { type: String, required: true, enum: ['recruiter', 'interviewer', 'admin', 'candidate'], default: 'interviewer' },
  passwordHash: { type: String, required: true },
  passwordSalt: { type: String, required: true },
  active: { type: Boolean, default: true },
  seedVersion: { type: Number, default: 0, min: 0 },
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', default: null }
}, { timestamps: true });
module.exports = mongoose.model('User', userSchema);
