'use strict';
const Candidate = require('./models/Candidate');
const Pipeline = require('./models/Pipeline');
// Hiring metrics computed live from MongoDB so every client sees the same numbers.
const STEP_RANGE = [1, 2, 3, 4, 5];
const STAGE_LABELS = {
  1: 'Applied / Sourced',
  2: 'Initial Screening',
  3: 'Technical Assessment',
  4: 'Background & Reference Checks',
  5: 'Offer & Onboarding'
};
function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
async function candidateScope(reqCode) {
  if (!reqCode) return {};
  const ids = await Pipeline.distinct('candidateId', { reqCode });
  return { _id: { $in: ids } };
}
async function pipelineScope(reqCode) {
  return reqCode ? { reqCode } : {};
}
// Totals, averages, per-step/per-status distributions and step-to-step conversion.
async function analyticsSummary(reqCode = '') {
  const [candidates, pipelines] = await Promise.all([
    Candidate.find(await candidateScope(reqCode)).lean(),
    Pipeline.find(await pipelineScope(reqCode)).lean()
  ]);
  const trustScores = candidates.map(item => Number(item.trustScore)).filter(Number.isFinite);
  const averageTrustScore = trustScores.length ? round(trustScores.reduce((a, b) => a + b, 0) / trustScores.length) : 0;
  const stageDistribution = {};
  const stepReached = {};
  for (const step of STEP_RANGE) {
    stageDistribution[step] = 0;
    stepReached[step] = 0;
  }
  const statusCounts = { pending: 0, in_progress: 0, completed: 0, on_hold: 0, rejected: 0 };
  for (const pipeline of pipelines) {
    const step = Number(pipeline.currentStep);
    if (STEP_RANGE.includes(step)) {
      stageDistribution[step] += 1;
      for (let reached = 1; reached <= step; reached += 1) stepReached[reached] += 1;
    }
    if (statusCounts[pipeline.status] !== undefined) statusCounts[pipeline.status] += 1;
  }
  const verificationCounts = { verified: 0, in_progress: 0, pending: 0 };
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const candidate of candidates) {
    if (verificationCounts[candidate.verificationStatus] !== undefined) verificationCounts[candidate.verificationStatus] += 1;
    if (tierCounts[candidate.clearanceTier] !== undefined) tierCounts[candidate.clearanceTier] += 1;
  }
  const conversion = { stepToStep: {}, startToCompleted: 0, startToOfferStep: 0 };
  for (let step = 1; step < 5; step += 1) {
    conversion.stepToStep[step + '->' + (step + 1)] = stepReached[step] ? round((stepReached[step + 1] / stepReached[step]) * 100) : 0;
  }
  if (stepReached[1]) {
    conversion.startToCompleted = round((statusCounts.completed / stepReached[1]) * 100);
    conversion.startToOfferStep = round((stepReached[5] / stepReached[1]) * 100);
  }
  return {
    reqCode: reqCode || 'all',
    totals: { candidates: candidates.length, hired: statusCounts.completed },
    averageTrustScore,
    stageDistribution,
    stageLabels: STAGE_LABELS,
    statusCounts,
    verificationCounts,
    tierCounts,
    conversion
  };
}
// Timeline metrics: how long hires take, offer conversion and per-requisition load.
// Shared by /api/admin/analytics and the Admin Dashboard /api/admin/metrics snapshot.
async function hiringTimeline(reqCode = '') {
  const scope = reqCode ? { reqCode } : {};
  const [completed, reachedStep5, perRequisition] = await Promise.all([
    Pipeline.find({ status: 'completed', ...scope }).select('createdAt updatedAt').lean(),
    Pipeline.countDocuments({ currentStep: 5, ...scope }),
    Pipeline.aggregate([
      ...(reqCode ? [{ $match: { reqCode } }] : []),
      { $group: { _id: '$reqCode', candidates: { $sum: 1 } } },
      { $sort: { candidates: -1 } }
    ])
  ]);
  let averageDaysToHire = null;
  if (completed.length) {
    const total = completed.reduce((sum, pipeline) => sum + (new Date(pipeline.updatedAt) - new Date(pipeline.createdAt)), 0);
    averageDaysToHire = round(total / completed.length / (1000 * 60 * 60 * 24));
  }
  return {
    averageDaysToHire,
    offerAcceptanceRate: reachedStep5 ? round((completed.length / reachedStep5) * 100) : 0,
    candidatesPerRequisition: perRequisition.map(item => ({ reqCode: item._id, candidates: item.candidates }))
  };
}
module.exports = { STEP_RANGE, STAGE_LABELS, analyticsSummary, hiringTimeline };