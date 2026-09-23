'use strict';
const { mongoose, connectDatabase } = require('./src/db');
const Candidate = require('./src/models/Candidate');
const Pipeline = require('./src/models/Pipeline');
const User = require('./src/models/User');
const { hashPassword } = require('./src/auth');

const samples = [
  { _id: '000000000000000000004091', name: 'Elena Rostova', role: 'Staff Distributed Systems Architect', email: 'elena.rostova@example.com', trustScore: 98, clearanceTier: 5, verifiedSkills: ['Distributed Systems', 'Python', 'Raft', 'Paxos'], location: 'San Francisco, CA', completion: 98 },
  { _id: '000000000000000000004092', name: 'Marcus Chen', role: 'Senior Frontend Engineer', email: 'marcus.chen@example.com', trustScore: 94, clearanceTier: 4, verifiedSkills: ['React', 'TypeScript', 'Accessibility'], location: 'Seattle, WA', completion: 100 },
  { _id: '000000000000000000004093', name: 'Priya Nair', role: 'Platform Engineer', email: 'priya.nair@example.com', trustScore: 85, clearanceTier: 3, verifiedSkills: ['Kubernetes', 'Go', 'SRE'], location: 'Austin, TX', completion: 64 },
  { _id: '000000000000000000004094', name: 'David Okafor', role: 'DevOps Lead', email: 'david.okafor@example.com', trustScore: 82, clearanceTier: 3, verifiedSkills: ['AWS', 'Terraform', 'CI/CD'], location: 'Chicago, IL', completion: 58 }
];
const verification = [
  { verificationStatus: 'verified', idDocuments: ['Verified US Passport'], status: 'in_progress', currentStep: 4 },
  { verificationStatus: 'verified', idDocuments: ['Verified State ID'], status: 'completed', currentStep: 5 },
  { verificationStatus: 'pending', idDocuments: ['Passport verification pending'], status: 'on_hold', currentStep: 4 },
  { verificationStatus: 'in_progress', idDocuments: ['Identity review in progress'], status: 'in_progress', currentStep: 3 }
];
// Demo team accounts for the login screen. Passwords are hashed with scrypt; this file is the only
// place they appear in plain text (see README for the credentials).
// Roles: admin (Morgan), recruiter (Ava + recruiter@), interviewer (Tara + Sam + interviewer@),
// candidate (Riley, linked to the seeded Elena Rostova application).
const team = [
  { name: 'Ava Recruiter', email: 'hiring@honesthire.app', role: 'recruiter', password: 'hire1234' },
  { name: 'Riley Recruiter', email: 'recruiter@honesthire.app', role: 'recruiter', password: 'hire1234' },
  { name: 'Tara Lin', email: 'tara.lin@honesthire.app', role: 'interviewer', password: 'panel1234' },
  { name: 'Sam Patel', email: 'sam.patel@honesthire.app', role: 'interviewer', password: 'panel1234' },
  { name: 'Izzy Interviewer', email: 'interviewer@honesthire.app', role: 'interviewer', password: 'panel1234' },
  { name: 'Morgan Admin', email: 'admin@honesthire.app', role: 'admin', password: 'SHAMANTH@KAALAMITHRA' },
  { name: 'Riley Applicant', email: 'candidate@honesthire.app', role: 'candidate', password: 'candidate1234', candidateId: '000000000000000000004091' }
];
async function seedUsers() {
  await User.init();
  for (const member of team) {
    const { passwordSalt, passwordHash } = hashPassword(member.password);
    // Insert-only: rerunning the seed never resets a changed password.
    const record = {
      name: member.name, email: member.email, role: member.role, passwordSalt, passwordHash, active: true, seedVersion: 1
    };
    // Seed-managed portal link for role:'candidate'; authoritatively keyed to the
    // same candidateId so reruns keep the demo portal working even if the link
    // was cleared by hand.
    if (member.candidateId != null) record.candidateId = member.candidateId;
    await User.updateOne({ email: member.email }, { $setOnInsert: record }, { upsert: true, runValidators: true });
    // One-time rotation of the admin credential (seedVersion 2). After it runs once,
    // a later manual password change is preserved like every other seeded account.
    if (member.role === 'admin') {
      await User.updateOne({ email: member.email, seedVersion: { $ne: 2 } },
        { $set: { passwordSalt, passwordHash, seedVersion: 2 } }, { runValidators: true });
    }
    if (member.candidateId != null) {
      await User.updateOne(
        { email: member.email, $or: [{ candidateId: null }, { candidateId: { $exists: false } }] },
        { $set: { candidateId: member.candidateId } }, { runValidators: true });
    }
  }
}
async function seed() {
  await Promise.all([Candidate.init(), Pipeline.init()]);
  for (const [index, { completion, ...candidate }] of samples.entries()) {
    const { verificationStatus, idDocuments, status, currentStep } = verification[index];
    const newFields = { verificationStatus, idDocuments, seedVersion: 3 };
    // Ensure every seeded candidate has a tier (derives from trustScore when omitted).
    const tier = candidate.clearanceTier != null ? candidate.clearanceTier
      : Math.max(1, Math.min(5, Math.ceil(Number(candidate.trustScore) / 20)));
    const normalizedCandidate = { ...candidate, clearanceTier: tier };
    // Seed emails stay current on rerun; every other candidate field still preserves later edits.
    await Candidate.updateOne({ _id: candidate._id }, { $setOnInsert: { ...normalizedCandidate, ...newFields, feedback: [], documents: [] } }, { upsert: true, runValidators: true });
    // Upgrade only these known demo IDs once; preserve names, scores, locations and later edits.
    await Candidate.updateOne({ _id: candidate._id, seedVersion: { $ne: 3 } }, { $set: { ...newFields, clearanceTier: tier } }, { runValidators: true });
    await Candidate.updateOne({ _id: candidate._id }, { $set: { email: candidate.email } }, { runValidators: true });
    await Candidate.updateOne({ _id: candidate._id, feedback: { $exists: false } }, { $set: { feedback: [] } }, { runValidators: true });
    // Uploaded resumes/ID files must survive a reseed, so the default is insert-only.
    await Candidate.updateOne({ _id: candidate._id, documents: { $exists: false } }, { $set: { documents: [] } }, { runValidators: true });
    const stage = { status, currentStep, seedVersion: 2 };
    await Pipeline.updateOne({ candidateId: candidate._id }, { $setOnInsert: {
      candidateId: candidate._id, reqCode: 'REQ-4091', completionPercentage: completion, ...stage
    } }, { upsert: true, runValidators: true });
    await Pipeline.updateOne({ candidateId: candidate._id, seedVersion: { $ne: 2 } }, { $set: stage }, { runValidators: true });
  }
  await seedUsers();
}
if (require.main === module) {
  connectDatabase().then(seed)
    .then(() => console.log('Sample candidates, pipelines and team accounts seeded (existing records preserved).'))
    .catch(error => { console.error('Seed failed:', error.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
module.exports = { seed, samples, team };
