'use strict';
const { Router } = require('express');
const { mongoose } = require('./db');
const Candidate = require('./models/Candidate');
const Pipeline = require('./models/Pipeline');
const { HttpError, object, feedbackInput } = require('./validation');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

module.exports = function createMongoRoutes() {
  const router = Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (mongoose.connection.readyState !== 1) return next(new HttpError(503, 'MongoDB is unavailable.'));
    next();
  });
  router.get('/candidates', wrap(async (req, res) => {
    const allowed = ['q', 'reqCode', 'minTrust', 'tier', 'verificationStatus'];
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
      if (!['verified', 'in_progress', 'pending'].includes(params.verificationStatus)) throw new HttpError(400, 'Invalid verificationStatus.');
      where.verificationStatus = params.verificationStatus;
    }
    if (params.reqCode && params.reqCode !== 'all') {
      where._id = { $in: await Pipeline.distinct('candidateId', { reqCode: params.reqCode }) };
    }
    const [items, total, reqCodes] = await Promise.all([
      Candidate.find(where).sort({ trustScore: -1, name: 1 }).lean(),
      Candidate.countDocuments(), Pipeline.distinct('reqCode')
    ]);
    const pipelines = await Pipeline.find({ candidateId: { $in: items.map(item => item._id) } }).lean();
    const byCandidate = new Map(pipelines.map(item => [String(item.candidateId), item]));
    res.json({ items: items.map(item => ({ ...item, pipeline: byCandidate.get(String(item._id)) || null })), total, matched: items.length, reqCodes: reqCodes.sort() });
  }));
  router.patch('/candidates/:id/feedback', wrap(async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      throw new HttpError(400, 'id must be a MongoDB ObjectId.');
    }
    const { text } = feedbackInput(req.body);
    const item = await Candidate.findOneAndUpdate(
      { _id: req.params.id },
      { $push: { feedback: { text, createdAt: new Date() } } },
      { new: true, runValidators: true }
    ).lean();
    if (!item) throw new HttpError(404, 'Candidate not found.');
    res.json(item);
  }));
  router.patch('/candidates/:id/feedback', wrap(async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      throw new HttpError(400, 'id must be a MongoDB ObjectId.');
    }
    const { text } = feedbackInput(req.body);
    const item = await Candidate.findOneAndUpdate(
      { _id: req.params.id },
      { $push: { feedback: { text, createdAt: new Date() } } },
      { new: true, runValidators: true }
    ).lean();
    if (!item) throw new HttpError(404, 'Candidate not found.');
    res.json(item);
  }));
  return router;
};

