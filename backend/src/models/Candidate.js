'use strict';
const { mongoose } = require('../db');
// Metadata for files stored in GridFS (src/documents.js). The bytes live in candidateFiles.files,
// this array is what the API returns so the roster stays lightweight.
const documentSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  kind: { type: String, required: true, enum: ['resume', 'id_verification', 'other'], default: 'other' },
  contentType: { type: String, required: true, trim: true, maxlength: 120 },
  size: { type: Number, required: true, min: 0 },
  uploadedBy: { type: String, trim: true, maxlength: 120, default: 'Team member' },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });
const candidateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  role: { type: String, required: true, trim: true, maxlength: 300 },
  // Optional contact used as the simulated-email recipient; blank means "no email on file".
  email: {
    type: String, trim: true, lowercase: true, maxlength: 200, default: '',
    validate: { validator: value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), message: 'Invalid email.' }
  },
  trustScore: { type: Number, required: true, min: 0, max: 100 },
  clearanceTier: { type: Number, min: 1, max: 5, default: null, validate: { validator: v => v == null || Number.isInteger(v), message: 'clearanceTier must be an integer.' } },
  verifiedSkills: [{ type: String, trim: true, maxlength: 100 }],
  location: { type: String, required: true, trim: true, maxlength: 200 },
  verificationStatus: { type: String, required: true, enum: ['verified', 'in_progress', 'pending'], default: 'pending' },
  idDocuments: [{ type: String, trim: true, maxlength: 200 }],
  documents: { type: [documentSchema], default: [] },
  // author/authorId/role come from the logged-in team member (src/auth.js), never from the body.
  feedback: {
    type: [{
      text: { type: String, required: true, trim: true, maxlength: 2000 },
      author: { type: String, trim: true, maxlength: 120, default: 'Team member' },
      authorId: { type: String, trim: true, maxlength: 40, default: '' },
      role: { type: String, trim: true, maxlength: 40, default: '' },
      createdAt: { type: Date, default: Date.now }
    }],
    default: []
  },
  seedVersion: { type: Number, default: 0, min: 0 }
}, { timestamps: true });
candidateSchema.pre('validate', function (next) {
  // Derive a 1-5 clearance tier from the trust score when none was supplied, so inserts without an
  // explicit tier always succeed. The API still requires one on input; this is the model-level safety net.
  if (this.clearanceTier == null) {
    const score = Number(this.trustScore) || 0;
    this.clearanceTier = Math.max(1, Math.min(5, Math.ceil(score / 20)));
  }
  next();
});
module.exports = mongoose.model('Candidate', candidateSchema);
