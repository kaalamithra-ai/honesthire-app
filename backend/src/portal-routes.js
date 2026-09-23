'use strict';
const express = require('express');
const { Router } = require('express');
const { mongoose, requireDatabase } = require('./db');
const Candidate = require('./models/Candidate');
const Pipeline = require('./models/Pipeline');
const User = require('./models/User');
const { HttpError, documentUploadInput } = require('./validation');
const { requireUser, requireOwnCandidate } = require('./auth');
const { writeAudit } = require('./audit');
const documents = require('./documents');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
// Binary bodies are read here (never through express.json) and streamed into GridFS.
const uploadMedia = express.raw({ type: documents.ALLOWED_TYPES, limit: documents.MAX_FILE_BYTES });

// Candidate Portal: role:'candidate' endpoints scoped entirely to the caller's own
// application. Every handler resolves the linked candidate from req.ownCandidateId
// (set by requireOwnCandidate), so applicants can never name another record.
module.exports = function createPortalRoutes() {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireDatabase, requireUser, requireOwnCandidate);
  async function ownApplication(candidateId) {
    const item = await Candidate.findById(candidateId).lean();
    if (!item) throw new HttpError(404, 'Candidate not found.');
    const pipeline = await Pipeline.findOne({ candidateId: item._id }).lean();
    return { ...item, pipeline: pipeline || null };
  }
  // Own application step, status, trust score, documents and interview feedback.
  router.get('/me', wrap(async (req, res) => {
    const { feedback, ...rest } = await ownApplication(req.ownCandidateId);
    res.json({ candidate: rest, feedback: feedback || [] });
  }));
  // Own resume / ID upload. Accepts the same raw-body contract as the internal
  // document endpoint, then mirrors the metadata on the caller's own record.
  router.post('/documents', uploadMedia, wrap(async (req, res) => {
    const { kind, name, contentType } = documentUploadInput(req.query, req.get('content-type'));
    const candidate = await Candidate.findById(req.ownCandidateId);
    if (!candidate) throw new HttpError(404, 'Candidate not found.');
    const saved = await documents.saveDocument({
      candidateId: candidate._id, kind, contentType, buffer: req.body,
      name: name || documents.defaultName(kind, contentType), uploadedBy: req.user.name
    });
    try {
      candidate.documents.push(saved);
      await candidate.save();
    } catch (error) {
      await documents.removeDocument(saved.fileId);
      throw error;
    }
    await writeAudit(req, 'document_uploaded', { kind: 'candidate', id: req.ownCandidateId, label: candidate.name }, { fileId: saved.fileId, kind: saved.kind, size: saved.size, via: 'portal' }, req.user);
    res.status(201).json({ document: saved, documents: candidate.documents.map(entry => entry.toObject()), uploadedBy: req.user.name });
  }));
  return router;
};
