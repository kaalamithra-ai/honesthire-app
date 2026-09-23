'use strict';
const { mongoose } = require('../db');
const pipelineSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, unique: true },
  reqCode: { type: String, required: true, trim: true, maxlength: 100 },
  currentStep: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  completionPercentage: { type: Number, required: true, min: 0, max: 100 },
  status: { type: String, required: true, enum: ['pending', 'in_progress', 'completed', 'on_hold', 'rejected'] },
  seedVersion: { type: Number, default: 0, min: 0 }
}, { timestamps: true });
module.exports = mongoose.model('Pipeline', pipelineSchema);
