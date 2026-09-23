'use strict';
const express = require('express');
const { Router } = require('express');
const { mongoose, requireDatabase } = require('./db');
const Candidate = require('./models/Candidate');
const Pipeline = require('./models/Pipeline');
const User = require('./models/User');
const { HttpError, candidateCreateInput, checksInput, documentUploadInput, feedbackInput, emailField, analyticsInput, notificationsInput, VERIFICATION_STATUSES } = require('./validation');
const { requireUser, actorFromRequest, requireStaff, requireOwnCandidate, STAFF_ROLES } = require('./auth');
const { writeAudit } = require('./audit');
const documents = require('./documents');
const notifications = require('./notifications');
const reporting = require('./export');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
// Staff always pass. A candidate passes only when the target :id is their own
// application, so existing staff tooling keeps working while an applicant is
// strictly scoped to their own record.
function requireStaffOrOwnCandidate(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Log in to continue.'));
  if (STAFF_ROLES.includes(req.user.role)) return next();
  return requireOwnCandidate(req, res, next);
}
// Applicants see only their own application. Attach the caller's user (or none)
// and shrink a candidate caller to their linked record; the public feed shape
// and guest results are unchanged.
async function requireOwnRecord(req, res, next) {
  try {
    const user = await actorFromRequest(req);
    req.actor = user && user.id ? user : null;
    if (!req.actor || req.actor.role !== 'candidate') return next();
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return next();
    const target = String(req.params.id);
    const owner = await User.findById(req.actor.id).select('candidateId').lean();
    if (!owner || !owner.candidateId || String(owner.candidateId) !== target) {
      return next(new HttpError(404, 'Candidate not found.'));
    }
    next();
  } catch (error) { next(error); }
}
// Binary bodies are read here (never through express.json) and streamed straight into GridFS.
const uploadMedia = express.raw({ type: documents.ALLOWED_TYPES, limit: documents.MAX_FILE_BYTES });
const objectId = (value, name) => {
  if (!mongoose.isObjectIdOrHexString(value)) throw new HttpError(400, name + ' must be a MongoDB ObjectId.');
  return value;
};

module.exports = function createMongoRoutes() {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireDatabase);
  router.get('/candidates', wrap(async (req, res) => {
    const user = await actorFromRequest(req);
    // Signed-in candidates are scoped to their linked record; everyone else
    // (guests and staff) keeps the unchanged public feed behavior.
    const where = await candidateFilter(req);
    if (user && user.role === 'candidate') {
      const owner = await User.findById(user.id).select('candidateId').lean();
      where._id = owner && owner.candidateId ? owner.candidateId : { $in: [] };
    }
    const items = await filteredCandidates(where);
    const [total, reqCodes] = await Promise.all([Candidate.countDocuments(), Pipeline.distinct('reqCode')]);
    if (user && user.role === 'candidate') {
      const scoped = items.filter(item => String(item._id) === String(where._id));
      return res.json({ items: scoped, total: scoped.length, matched: scoped.length, reqCodes: reqCodes.sort() });
    }
    res.json({ items, total, matched: items.length, reqCodes: reqCodes.sort() });
  }));
  // Same filters as the feed, one code path reused by the JSON list and the CSV download.
  async function candidateFilter(req) {
    const allowed = ['q', 'reqCode', 'minTrust', 'tier', 'verificationStatus', 'stage'];
    const params = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (!allowed.includes(key) || typeof value !== 'string' || value.length > 200) {
        throw new HttpError(400, 'Invalid query parameter: ' + key);
      }
      params[key] = value.trim();
    }
    const where = {};
    if (params.q) {
      const literal = params.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      where.$or = ['name', 'role', 'verifiedSkills'].map(key => ({ [key]: { $regex: literal, $options: 'i' } }));
    }
    if (params.minTrust) {
      if (!/^\d+$/.test(params.minTrust) || Number(params.minTrust) > 100) throw new HttpError(400, 'minTrust must be 0–100.');
      where.trustScore = { $gte: Number(params.minTrust) };
    }
    if (params.tier && params.tier !== 'any') {
      if (!/^[1-5]$/.test(params.tier)) throw new HttpError(400, 'tier must be 1–5 or any.');
      where.clearanceTier = { $gte: Number(params.tier) };
    }
    if (params.verificationStatus && params.verificationStatus !== 'all') {
      if (!VERIFICATION_STATUSES.includes(params.verificationStatus)) throw new HttpError(400, 'Invalid verificationStatus.');
      where.verificationStatus = params.verificationStatus;
    }
    // Requisition and pipeline stage both live on Pipeline; $and intersects them when combined.
    const pipelineFilters = [];
    if (params.reqCode && params.reqCode !== 'all') pipelineFilters.push({ reqCode: params.reqCode });
    if (params.stage && params.stage !== 'any') {
      if (!/^[1-5]$/.test(params.stage)) throw new HttpError(400, 'stage must be 1–5 or any.');
      pipelineFilters.push({ currentStep: Number(params.stage) });
    }
    if (pipelineFilters.length) {
      where._id = { $in: await Pipeline.distinct('candidateId', pipelineFilters.length > 1 ? { $and: pipelineFilters } : pipelineFilters[0]) };
    }
    return where;
  }
    // Trust-score order with the pipeline joined in; used by the feed, the export and analytics scoping.
  async function filteredCandidates(where) {
    const items = await Candidate.find(where).sort({ trustScore: -1, name: 1 }).lean();
    const pipelines = await Pipeline.find({ candidateId: { $in: items.map(item => item._id) } }).lean();
    const byCandidate = new Map(pipelines.map(item => [String(item.candidateId), item]));
    return items.map(item => ({ ...item, pipeline: byCandidate.get(String(item._id)) || null }));
  }
  router.get('/candidates/export', requireUser, requireStaff, wrap(async (req, res) => {
    const where = await candidateFilter(req);
        const items = await filteredCandidates(where);
    await writeAudit(req, 'export_generated', { kind: 'feed', label: 'candidates-export.csv' }, { count: items.length });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="candidates-export.csv"');
    res.send(reporting.exportCsv(items));
  }));
  router.post('/candidates', requireUser, requireStaff, wrap(async (req, res) => {
    const { candidate, pipeline } = candidateCreateInput(req.body);
    const saved = await Candidate.create(candidate);
    let savedPipeline = null;
    if (pipeline) {
      try {
        savedPipeline = await Pipeline.create({ ...pipeline, candidateId: saved._id });
      } catch (error) {
        // No transactions on the standalone server: remove the orphan candidate.
        await Candidate.deleteOne({ _id: saved._id });
        if (error && error.code === 11000) throw new HttpError(409, 'A pipeline already exists for this candidate.');
        throw error;
      }
    }
    const out = await Candidate.findById(saved._id).lean();
    const created = { ...out, pipeline: savedPipeline ? await Pipeline.findById(savedPipeline._id).lean() : null };
    // Simulated welcome email: persisted, never actually sent.
    try {
      const actor = await actorFromRequest(req);
      const email = notifications.composePipelineEmail({
        candidate: out, pipeline: created.pipeline, action: 'advance',
        fromStep: 1, toStep: created.pipeline ? created.pipeline.currentStep : 1,
        fromStatus: 'pending', toStatus: created.pipeline ? created.pipeline.status : 'pending', actor
      });
      await notifications.queueNotification({ candidate: out, pipeline: created.pipeline, kind: 'candidate_created', subject: email.subject, body: email.body, actor, snapshot: { fromStep: 1, toStep: created.pipeline ? created.pipeline.currentStep : 1, fromStatus: 'pending', toStatus: created.pipeline ? created.pipeline.status : 'pending' } });
    } catch (error) { console.error('Notification log failed:', error.message); }
        await writeAudit(req, 'candidate_created', { kind: 'candidate', id: String(saved._id), label: saved.name }, { trustScore: saved.trustScore, clearanceTier: saved.clearanceTier, hasPipeline: Boolean(pipeline) });
    res.status(201).json(created);
  }));
  router.get('/candidates/:id', requireOwnRecord, wrap(async (req, res) => {
    objectId(req.params.id, 'id');
    const item = await Candidate.findById(req.params.id).lean();
    if (!item) throw new HttpError(404, 'Candidate not found.');
    const pipeline = await Pipeline.findOne({ candidateId: item._id }).lean();
    res.json({ ...item, pipeline: pipeline || null });
  }));
  // Feedback is attributable: the author comes from the bearer token, never from the request body.
  // Staff-only: candidates read feedback through the portal, never write or see other records.
  router.patch('/candidates/:id/feedback', requireUser, requireStaff, wrap(async (req, res) => {
    objectId(req.params.id, 'id');
    const { text } = feedbackInput(req.body);
    const item = await Candidate.findOneAndUpdate(
      { _id: req.params.id },
      { $push: { feedback: { text, author: req.user.name, authorId: req.user.id, role: req.user.role, createdAt: new Date() } } },
      { new: true, runValidators: true }
    ).lean();
    if (!item) throw new HttpError(404, 'Candidate not found.');
    // Simulated thank-you note to the candidate's file; never actually sent.
    try {
      const pipeline = await Pipeline.findOne({ candidateId: item._id }).lean();
      await notifications.queueNotification({
        candidate: item, pipeline, kind: 'feedback_added',
        subject: 'Honest Hire update: ' + item.name + ' — interview feedback recorded',
        body: [
          'Hi ' + item.name + ',',
          '',
          'This is a simulated note confirming that interview feedback was recorded by ' + req.user.name + ' (' + req.user.role + ').',
          'Feedback entries on file: ' + (item.feedback ? item.feedback.length : 0) + '.',
          '',
          'No email was actually sent — this message is logged in MongoDB for the hiring team to review.',
          '— Honest Hire (simulated email)'
        ].join('\n'),
        actor: req.user,
        snapshot: { fromStep: pipeline ? pipeline.currentStep : 1, toStep: pipeline ? pipeline.currentStep : 1, fromStatus: pipeline ? pipeline.status : 'pending', toStatus: pipeline ? pipeline.status : 'pending' }
      });
    } catch (error) { console.error('Notification log failed:', error.message); }
        await writeAudit(req, 'feedback_added', { kind: 'candidate', id: req.params.id, label: item.name }, { feedbackCount: item.feedback ? item.feedback.length : 0 }, req.user);
    res.json(item);
  }));
  // Background checks live on the candidate record: verificationStatus drives the
  // feed filter and the admin metrics, so staff updates must persist immediately.
  router.patch('/candidates/:id/checks', requireUser, requireStaff, wrap(async (req, res) => {
    objectId(req.params.id, 'id');
    const data = checksInput(req.body);
    const item = await Candidate.findByIdAndUpdate(req.params.id, { $set: data }, { new: true, runValidators: true }).lean();
    if (!item) throw new HttpError(404, 'Candidate not found.');
        await writeAudit(req, 'checks_updated', { kind: 'candidate', id: req.params.id, label: item.name }, { verificationStatus: item.verificationStatus, idDocuments: item.idDocuments }, req.user);
    res.json(item);
  }));
  router.get('/candidates/:id/documents', wrap(async (req, res) => {
    objectId(req.params.id, 'id');
    const item = await Candidate.findById(req.params.id).select('name documents').lean();
    if (!item) throw new HttpError(404, 'Candidate not found.');
    res.json({ candidateId: String(item._id), candidateName: item.name, items: item.documents || [] });
  }));
  // Body is the raw file bytes; metadata travels in ?kind= / ?name= and the Content-Type header.
  // Candidates manage their own files through /api/portal/*; this internal endpoint
  // still serves staff uploads while remaining own-record scoped for candidates.
  router.post('/candidates/:id/documents', requireUser, requireStaffOrOwnCandidate, uploadMedia, wrap(async (req, res) => {
    objectId(req.params.id, 'id');
    const { kind, name, contentType } = documentUploadInput(req.query, req.get('content-type'));
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) throw new HttpError(404, 'Candidate not found.');
    const saved = await documents.saveDocument({
      candidateId: candidate._id, kind, contentType, buffer: req.body,
      name: name || documents.defaultName(kind, contentType), uploadedBy: req.user.name
    });
    try {
      candidate.documents.push(saved);
      await candidate.save();
    } catch (error) {
      // Standalone MongoDB has no transactions: never leave an orphaned GridFS file behind.
      await documents.removeDocument(saved.fileId);
      throw error;
    }
        await writeAudit(req, 'document_uploaded', { kind: 'candidate', id: req.params.id, label: candidate.name }, { fileId: saved.fileId, kind: saved.kind, size: saved.size }, req.user);
    res.status(201).json({ document: saved, documents: candidate.documents.map(entry => entry.toObject()), uploadedBy: req.user.name });
  }));
  router.get('/documents/:fileId', async (req, res, next) => {
    try {
      const file = await documents.findDocument(req.params.fileId);
      if (!file) throw new HttpError(404, 'Document not found.');
      // A signed-in applicant may only download their own application files.
      const user = await actorFromRequest(req);
      if (user && user.role === 'candidate') {
        const linked = file.metadata && file.metadata.candidateId;
        const owner = await User.findById(user.id).select('candidateId').lean();
        if (!owner || !owner.candidateId || String(owner.candidateId) !== String(linked)) {
          throw new HttpError(404, 'Document not found.');
        }
      }
    } catch (error) { return next(error); }
    documents.openDownloadStream(req.params.fileId).then(({ file, stream }) => {
      res.set('Content-Type', file.contentType || 'application/octet-stream');
      res.set('Content-Length', String(file.length || 0));
      res.set('Content-Disposition', (req.query.download ? 'attachment' : 'inline') + '; filename="' + documents.sanitizeName(file.filename).replace(/"/g, '') + '"');
      stream.on('error', error => {
        if (res.headersSent) return res.destroy(error);
        next(new HttpError(500, 'Could not read the stored document.'));
      });
      stream.pipe(res);
    }).catch(next);
  });
  router.delete('/candidates/:id/documents/:fileId', requireUser, requireStaff, wrap(async (req, res) => {
    objectId(req.params.id, 'id');
    objectId(req.params.fileId, 'fileId');
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) throw new HttpError(404, 'Candidate not found.');
    const index = candidate.documents.findIndex(entry => entry.fileId === String(req.params.fileId));
    if (index === -1) throw new HttpError(404, 'Document not found on this candidate.');
    const [removed] = candidate.documents.splice(index, 1);
    await candidate.save();
    await documents.removeDocument(removed.fileId);
        await writeAudit(req, 'document_deleted', { kind: 'candidate', id: req.params.id, label: candidate.name }, { fileId: removed.fileId, kind: removed.kind }, req.user);
    res.json({ removed: removed.fileId, documents: candidate.documents.map(entry => entry.toObject()) });
  }));
  router.get('/pipeline/:candidateId', wrap(async (req, res) => {
    objectId(req.params.candidateId, 'candidateId');
    const item = await Pipeline.findOne({ candidateId: req.params.candidateId }).lean();
    if (!item) throw new HttpError(404, 'Pipeline not found.');
    res.json(item);
  }));
  router.patch('/pipeline/:candidateId', requireUser, requireStaff, wrap(async (req, res) => {
    objectId(req.params.candidateId, 'candidateId');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'Expected a JSON object.');
    if (Object.keys(req.body).length !== 1 || typeof req.body.action !== 'string') {
      throw new HttpError(400, 'Provide exactly one field: action.');
    }
    if (!['advance', 'offer', 'hold', 'reject'].includes(req.body.action)) {
      throw new HttpError(400, 'action must be advance, offer, hold or reject.');
    }
    const pipeline = await Pipeline.findOne({ candidateId: req.params.candidateId });
    if (!pipeline) throw new HttpError(404, 'Pipeline not found.');
    // Capture the true starting point BEFORE mutating, so audit entries and
    // notification snapshots report the real from -> to transition.
    const fromStep = pipeline.currentStep;
    const fromStatus = pipeline.status;
    if (req.body.action === 'advance') {
      if (pipeline.currentStep >= 5) throw new HttpError(409, 'Pipeline is already at Step 5.');
      pipeline.currentStep += 1;
      pipeline.status = 'in_progress';
    } else if (req.body.action === 'offer') {
      if (pipeline.currentStep !== 5 || pipeline.completionPercentage !== 100) {
        throw new HttpError(409, 'Final offer requires Step 5 and 100% completion.');
      }
      pipeline.status = 'completed';
    } else if (req.body.action === 'hold') {
      pipeline.status = 'on_hold';
    } else {
      pipeline.status = 'rejected';
    }
    await pipeline.save();
    const snapshot = {
      reqCode: pipeline.reqCode,
      fromStep, toStep: pipeline.currentStep,
      fromStatus, toStatus: pipeline.status
    };
    const candidate = await Candidate.findById(req.params.candidateId).lean();
    if (candidate) {
      const actor = await actorFromRequest(req);
      const email = notifications.composePipelineEmail({
        candidate, pipeline, action: req.body.action,
        fromStep, toStep: pipeline.currentStep,
        fromStatus, toStatus: pipeline.status, actor
      });
      try {
        const saved = await notifications.queueNotification({
          candidate, pipeline, kind: fromStep === pipeline.currentStep ? 'status_changed' : 'stage_changed',
          subject: email.subject, body: email.body, actor, snapshot
        });
      } catch (error) { console.error('Notification log failed:', error.message); }
    }
        await writeAudit(req, 'pipeline_changed', { kind: 'candidate', id: req.params.candidateId, label: candidate ? candidate.name : '' }, { action: req.body.action, fromStep, toStep: pipeline.currentStep, fromStatus, toStatus: pipeline.status });
    res.json(pipeline);
  }));
  router.get('/candidates/:id/notifications', wrap(async (req, res) => {
    objectId(req.params.id, 'id');
    const { limit } = notificationsInput(req.query);
    const candidate = await Candidate.findById(req.params.id).lean();
    if (!candidate) throw new HttpError(404, 'Candidate not found.');
    const items = await notificationsFor(candidate, limit);
    res.json({ candidateId: String(candidate._id), candidateName: candidate.name, recipient: notifications.recipientFor(candidate), items });
  }));
  router.get('/notifications', wrap(async (req, res) => {
    const { limit } = notificationsInput(req.query);
    const items = await Notification.find().sort({ createdAt: -1 }).limit(limit).select('-__v').lean();
    res.json({ items, count: items.length });
  }));
  router.get('/analytics/summary', wrap(async (req, res) => {
    const { reqCode } = analyticsInput(req.query);
        res.json(await analyticsSummary(reqCode));
  }));
  return router;
};
