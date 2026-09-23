'use strict';
const { mongoose, connectDatabase } = require('./src/db');
const Candidate = require('./src/models/Candidate');
const Pipeline = require('./src/models/Pipeline');
const User = require('./src/models/User');
const Session = require('./src/models/Session');
const Notification = require('./src/models/Notification');
const documents = require('./src/documents');
// Stable IDs used by backend/seed.js for the demo roster.
const SEED_IDS = [
  '000000000000000000004091',
  '000000000000000000004092',
  '000000000000000000004093',
  '000000000000000000004094'
];
const SEED_NAMES = ['Elena Rostova', 'Marcus Chen', 'Priya Nair', 'David Okafor'];
// Keep in sync with backend/seed.js team[]. Cleanup removes exactly these demo
// accounts (and their sessions), leaving manually added members intact.
const SEED_EMAILS = ['hiring@honesthire.app', 'recruiter@honesthire.app', 'tara.lin@honesthire.app', 'sam.patel@honesthire.app', 'interviewer@honesthire.app', 'admin@honesthire.app', 'candidate@honesthire.app'];
async function clean() {
  await Promise.all([Candidate.init(), Pipeline.init(), User.init(), Session.init(), Notification.init()]);
  const seeded = await Candidate.find({ $or: [{ _id: { $in: SEED_IDS } }, { name: { $in: SEED_NAMES } }] }, { _id: 1, documents: 1 }).lean();
  const ids = seeded.map(item => item._id);
  // Uploaded resumes/ID files live in GridFS: remove them with their candidate.
  let files = 0;
  for (const item of seeded) {
    for (const entry of item.documents || []) {
      try { if (await documents.removeDocument(entry.fileId)) files += 1; }
      catch (error) { console.error('Could not delete stored file ' + entry.fileId + ':', error.message); }
    }
  }
  const pipelines = await Pipeline.deleteMany({ candidateId: { $in: ids } });
  const candidates = await Candidate.deleteMany({ _id: { $in: ids } });
// Only sessions belonging to the removed demo accounts are dropped.
  const users = await User.deleteMany({ email: { $in: SEED_EMAILS } });
  // Only sessions belonging to the removed demo accounts are dropped.
  const sessions = await Session.deleteMany({ email: { $in: SEED_EMAILS } });
  // Keep the audit style consistent: the demo notification log belongs to the demo roster.
  const notifications = await Notification.deleteMany({ candidateId: { $in: ids } });
  return {
    candidates: candidates.deletedCount || 0, pipelines: pipelines.deletedCount || 0,
    users: users.deletedCount || 0, sessions: sessions.deletedCount || 0, files,
    notifications: notifications.deletedCount || 0
  };
}
if (require.main === module) {
  connectDatabase().then(clean)
    .then(({ candidates, pipelines, users, files, notifications }) => console.log(`Removed ${candidates} demo candidate(s), ${pipelines} pipeline(s), ${users} team account(s), ${files} stored file(s) and ${notifications} notification(s).`))
    .catch(error => { console.error('Cleanup failed:', error.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
module.exports = { clean, SEED_IDS, SEED_NAMES, SEED_EMAILS };

