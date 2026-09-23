'use strict';
const { Router } = require('express');
const { HttpError, object, candidateInput, queryText } = require('./validation');
const candidateInclude = { pipeline: { include: { stage: true } } };
const pipelineInclude = { stage: true, candidate: true };
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

module.exports = function createRoutes(db) {
  const router = Router();
  router.get('/candidates', wrap(async (req, res) => {
    const q = queryText(req.query.q, 'q');
    const requisition = queryText(req.query.requisition, 'requisition');
    const minTrust = queryText(req.query.minTrust, 'minTrust');
    const tier = queryText(req.query.tier, 'tier');
    const where = {};
    if (q) where.OR = ['name', 'role', 'skills'].map(key => ({ [key]: { contains: q } }));
    if (requisition && requisition !== 'all') where.requisition = requisition;
    if (minTrust) {
      if (!/^\d+$/.test(minTrust) || Number(minTrust) > 100) throw new HttpError(400, 'minTrust must be 0–100.');
      where.trustScore = { gte: Number(minTrust) };
    }
    if (tier && tier !== 'any') {
      if (!/^[1-5]$/.test(tier)) throw new HttpError(400, 'tier must be 1–5 or any.');
      where.tier = { gte: Number(tier) };
    }
    const [items, total] = await db.$transaction([
      db.candidate.findMany({ where, include: candidateInclude, orderBy: [{ trustScore: 'desc' }, { name: 'asc' }] }),
      db.candidate.count()
    ]);
    res.json({ items, total });
  }));
  router.get('/candidates/:id', wrap(async (req, res) => {
    const item = await db.candidate.findUnique({ where: { id: req.params.id }, include: { ...candidateInclude, interviews: true } });
    if (!item) throw new HttpError(404, 'Candidate not found.');
    res.json(item);
  }));
  router.post('/candidates', wrap(async (req, res) => {
    const data = candidateInput(req.body);
    const first = await db.pipelineStage.findFirst({ orderBy: { position: 'asc' } });
    if (!first) throw new HttpError(503, 'Seed pipeline stages first.');
    const item = await db.candidate.create({ data: { ...data, pipeline: { create: { stageId: first.id } } }, include: candidateInclude });
    res.status(201).location('/api/candidates/' + item.id).json(item);
  }));
  router.patch('/candidates/:id', wrap(async (req, res) => {
    const data = candidateInput(req.body, true);
    const item = await db.$transaction(async tx => {
      const existing = await tx.candidate.findUnique({ where: { id: req.params.id }, include: candidateInclude });
      if (!existing) throw new HttpError(404, 'Candidate not found.');
      if (data.checksProgress !== undefined && data.checksProgress < 100 && existing.pipeline?.stageId === 'offer') {
        throw new HttpError(409, 'Cannot reduce checks while candidate is at Offer.');
      }
      return tx.candidate.update({ where: { id: req.params.id }, data, include: candidateInclude });
    });
    res.json(item);
  }));
  router.delete('/candidates/:id', wrap(async (req, res) => {
    await db.candidate.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }));
  router.get('/pipelines/stages', wrap(async (req, res) => {
    res.json({ items: await db.pipelineStage.findMany({ orderBy: { position: 'asc' } }) });
  }));
  router.get('/pipelines', wrap(async (req, res) => {
    const candidateId = queryText(req.query.candidateId, 'candidateId');
    res.json({ items: await db.pipeline.findMany({ where: candidateId ? { candidateId } : {}, include: pipelineInclude, orderBy: { createdAt: 'asc' } }) });
  }));
  router.get('/pipelines/:id', wrap(async (req, res) => {
    const item = await db.pipeline.findUnique({ where: { id: req.params.id }, include: pipelineInclude });
    if (!item) throw new HttpError(404, 'Pipeline not found.');
    res.json(item);
  }));
  router.patch('/pipelines/:id/stage', wrap(async (req, res) => {
    object(req.body);
    const { stageId, version } = req.body;
    if (typeof stageId !== 'string' || !Number.isInteger(version) || version < 0 || Object.keys(req.body).some(k => !['stageId', 'version'].includes(k))) {
      throw new HttpError(400, 'Provide stageId and a non-negative integer version.');
    }
    const item = await db.$transaction(async tx => {
      const pipeline = await tx.pipeline.findUnique({ where: { id: req.params.id }, include: pipelineInclude });
      if (!pipeline) throw new HttpError(404, 'Pipeline not found.');
      if (pipeline.version !== version) throw new HttpError(409, 'Pipeline changed. Reload and try again.');
      const stage = await tx.pipelineStage.findUnique({ where: { id: stageId } });
      if (!stage) throw new HttpError(400, 'Unknown pipeline stage.');
      if (stage.position !== pipeline.stage.position + 1) throw new HttpError(409, 'Advance exactly one stage at a time.');
      if (stage.id === 'offer' && pipeline.candidate.checksProgress !== 100) throw new HttpError(409, 'Offer is locked until checks reach 100%.');
      const updated = await tx.pipeline.updateMany({ where: { id: pipeline.id, version }, data: { stageId, version: { increment: 1 } } });
      if (!updated.count) throw new HttpError(409, 'Pipeline changed. Reload and try again.');
      return tx.pipeline.findUnique({ where: { id: pipeline.id }, include: pipelineInclude });
    });
    res.json(item);
  }));
  router.get('/interviews', wrap(async (req, res) => {
    const candidateId = queryText(req.query.candidateId, 'candidateId');
    res.json({ items: await db.interview.findMany({ where: candidateId ? { candidateId } : {}, include: { candidate: true, interviewer: true }, orderBy: { scheduledAt: 'asc' } }) });
  }));
  return router;
};
