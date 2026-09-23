'use strict';
const prisma = require('../src/db');

const stages = [
  { id: 'sourced', name: 'Applied / Sourced', position: 0 },
  { id: 'screening', name: 'Initial Screening', position: 1 },
  { id: 'assessment', name: 'Technical Assessment', position: 2 },
  { id: 'checks', name: 'Background & Reference Checks', position: 3 },
  { id: 'offer', name: 'Offer & Onboarding', position: 4 }
];
const candidates = [
  { id: 'elena', name: 'Elena Rostova', email: 'elena@example.test', role: 'Staff Distributed Systems Architect', skills: 'distributed systems python raft paxos stripe datadog', trustScore: 98, tier: 5, checksProgress: 98, summary: 'One peer reference is still pending.' },
  { id: 'marcus', name: 'Marcus Chen', email: 'marcus@example.test', role: 'Senior Frontend Engineer', skills: 'react typescript frontend accessibility', trustScore: 94, tier: 4, checksProgress: 100, summary: 'All demo checks complete; ready to advance.' },
  { id: 'priya', name: 'Priya Nair', email: 'priya@example.test', role: 'Platform Engineer', skills: 'kubernetes sre platform go', trustScore: 85, tier: 3, checksProgress: 64, summary: 'Payroll verification is pending.' },
  { id: 'david', name: 'David Okafor', email: 'david@example.test', role: 'DevOps Lead', skills: 'aws terraform devops ci-cd', trustScore: 82, tier: 3, checksProgress: 58, summary: 'Waiting on the final peer reference.' }
];
async function seed(db = prisma) {
  await db.$transaction(async tx => {
    for (const stage of stages) {
      await tx.pipelineStage.upsert({ where: { id: stage.id }, update: stage, create: stage });
    }
    await tx.user.upsert({ where: { id: 'demo-recruiter' }, update: {}, create: {
      id: 'demo-recruiter', name: 'A. Recruiter', email: 'recruiter@example.test'
    } });
    for (const candidate of candidates) {
      await tx.candidate.upsert({ where: { id: candidate.id }, update: {}, create: {
        ...candidate, recruiterId: 'demo-recruiter', requisition: 'REQ-4091'
      } });
      await tx.pipeline.upsert({ where: { candidateId: candidate.id }, update: {}, create: {
        id: 'pipeline-' + candidate.id, candidateId: candidate.id, stageId: 'checks'
      } });
      await tx.interview.upsert({ where: { id: 'interview-' + candidate.id }, update: {}, create: {
        id: 'interview-' + candidate.id, candidateId: candidate.id,
        interviewerId: 'demo-recruiter', scheduledAt: new Date('2026-09-21T17:00:00Z'),
        duration: 60, status: 'SCHEDULED'
      } });
    }
  });
}
if (require.main === module) {
  seed().then(() => console.log('Seeded demo user, stages, candidates, pipelines and interviews.'))
    .catch(error => { console.error(error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
module.exports = { seed, stages };
