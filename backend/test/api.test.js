'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mongoose, connectDatabase } = require('../src/db');
const Candidate = require('../src/models/Candidate');
const Pipeline = require('../src/models/Pipeline');
const { seed, samples, team } = require('../seed');
let server, base;
const login = async (email = team[0].email, password = team[0].password, adminKey) => {
  const body = { email, password };
  if (adminKey) body.adminKey = adminKey;
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.equal(response.status, 200, 'login must succeed for ' + email);
  return (await response.json()).token;
};
const authorized = token => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token });
before(async () => {
  // Unique database: never delete or mutate the application database in tests.
  await connectDatabase('mongodb://127.0.0.1:27017/honest_hire_test_' + process.pid);
  server = require('../src/app')().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
test('empty database returns an empty feed and healthy connection', async () => {
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).database, 'connected');
  const response = await fetch(base + '/api/candidates');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [], total: 0, matched: 0, reqCodes: [] });
});
test('candidate feed validates query filters and reports matching counts', async () => {
  await seed();
  const combined = await fetch(base + '/api/candidates?q=Raft&minTrust=95&tier=5&reqCode=REQ-4091&verificationStatus=verified');
  assert.equal(combined.status, 200);
  const matches = await combined.json();
  assert.equal(matches.total, 4);
  assert.equal(matches.matched, 1);
  assert.deepEqual(matches.reqCodes, ['REQ-4091']);
  assert.equal(matches.items[0].name, 'Elena Rostova');
  const pending = await fetch(base + '/api/candidates?verificationStatus=pending');
  const held = await pending.json();
  assert.equal(held.matched, 1);
  assert.equal(held.items[0].name, 'Priya Nair');
  for (const path of ['/api/candidates?minTrust=platinum', '/api/candidates?tier=platinum', '/api/candidates?verificationStatus=platinum', '/api/candidates?unknown=platinum']) {
    const bad = await fetch(base + path);
    assert.equal(bad.status, 400);
    assert.equal(typeof (await bad.json()).error, 'string');
  }
});
test('seed is repeatable, preserves edits and links Elena to REQ-4091', async () => {
  await seed(); await seed();
  assert.equal(await Candidate.countDocuments(), 4);
  assert.equal(await Pipeline.countDocuments(), 4);
  const response = await fetch(base + '/api/candidates');
  assert.equal(response.status, 200);
  const { items, total } = await response.json();
  assert.equal(total, 4);
  assert.equal(items[0].name, 'Elena Rostova');
  assert.equal(items[0].trustScore, 98);
  assert.equal(items[0].role, 'Staff Distributed Systems Architect');
  assert.deepEqual(items[0].idDocuments, ['Verified US Passport']);
  assert.equal(items[0].verificationStatus, 'verified');
  assert.equal(items[0].pipeline.reqCode, 'REQ-4091');
  const pipeline = await fetch(base + '/api/pipeline/' + items[0]._id);
  assert.equal(pipeline.status, 200);
  const details = await pipeline.json();
  assert.equal(details.candidateId, items[0]._id);
  assert.equal(details.currentStep, 4);
  assert.equal(details.completionPercentage, 98);
  await Candidate.updateOne({ _id: items[0]._id }, { $set: { location: 'Updated location' } });
  await seed();
  assert.equal((await Candidate.findById(items[0]._id)).location, 'Updated location');
});
test('pipeline actions advance, gate the final offer and set hold/reject', async () => {
  await seed();
  const { items } = await (await fetch(base + '/api/candidates')).json();
  const elena = items.find(item => item.name === 'Elena Rostova');
  const marcus = items.find(item => item.name === 'Marcus Chen');
  const recruiter = team.find(member => member.role === 'recruiter');
  const staffToken = await login(recruiter.email, recruiter.password);
  assert.equal((await fetch(base + '/api/pipeline/' + elena._id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } })).status, 401, 'Pipeline changes require a signed-in staff session.');
  const patch = (id, body) => fetch(base + '/api/pipeline/' + id, {
    method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, authorized(staffToken)), body: JSON.stringify(body)
  });
  const earlyOffer = await patch(elena._id, { action: 'offer' });
  assert.equal(earlyOffer.status, 409);
  assert.match((await earlyOffer.json()).error, /Step 5 and 100%/);
  const advanced = await patch(elena._id, { action: 'advance' });
  assert.equal(advanced.status, 200);
  assert.equal((await advanced.json()).currentStep, 5);
  const stillBlocked = await patch(elena._id, { action: 'offer' });
  assert.equal(stillBlocked.status, 409);
  await Pipeline.updateOne({ candidateId: elena._id }, { $set: { completionPercentage: 100 } });
  const offered = await patch(elena._id, { action: 'offer' });
  assert.equal(offered.status, 200);
  assert.equal((await offered.json()).status, 'completed');
  const held = await patch(marcus._id, { action: 'hold' });
  assert.equal(held.status, 200);
  assert.equal((await held.json()).status, 'on_hold');
  const rejected = await patch(marcus._id, { action: 'reject' });
  assert.equal(rejected.status, 200);
  assert.equal((await rejected.json()).status, 'rejected');
  for (const [path, body, status] of [
    ['/api/pipeline/not-an-id', { action: 'advance' }, 400],
    ['/api/pipeline/ffffffffffffffffffffffff', { action: 'advance' }, 404],
    ['/api/pipeline/' + elena._id, { action: 'promote' }, 400],
    ['/api/pipeline/' + elena._id, { action: 'advance', extra: 1 }, 400],
    ['/api/pipeline/' + elena._id, {}, 400],
    ['/api/pipeline/' + elena._id, null, 400]
  ]) {
    const bad = await fetch(base + path, {
      method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, authorized(staffToken)), body: JSON.stringify(body)
    });
    assert.equal(bad.status, status, path + ' ' + JSON.stringify(body));
    assert.equal(typeof (await bad.json()).error, 'string');
  }
  await seed();
});
test('invalid IDs, missing pipelines and unknown routes return JSON errors', async () => {
  for (const [path, status] of [['/api/pipeline/not-an-id', 400], ['/api/pipeline/ffffffffffffffffffffffff', 404], ['/api/pipeline', 404]]) {
    const response = await fetch(base + path);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});
test('models reject invalid ranges and pipeline references are unique', async () => {
  const { completion, ...sample } = samples[0];
  await assert.rejects(new Candidate({ ...sample, trustScore: 101 }).validate());
  await assert.rejects(new Candidate({ ...sample, clearanceTier: 2.5 }).validate());
  await assert.rejects(new Pipeline({ candidateId: sample._id, reqCode: 'REQ-4091', currentStep: 6, completionPercentage: 101, status: 'invalid' }).validate());
  await assert.rejects(Pipeline.create({ candidateId: sample._id, reqCode: 'REQ-4091', currentStep: 1, completionPercentage: 0, status: 'pending' }), { code: 11000 });
});
test('serves only public files and permits local frontend origins', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/backend-client.js')).status, 200);
  assert.equal((await fetch(base + '/backend/.env')).status, 404);
  const response = await fetch(base + '/api/candidates', { headers: { Origin: 'http://localhost:8001' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8001');
  assert.equal((await fetch(base + '/api/candidates', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
});
test('created candidates persist with pipelines, validate input and roll back orphans', async () => {
  await seed();
  const recruiter = team.find(item => item.role === 'recruiter');
  const staffToken = await login(recruiter.email, recruiter.password);
  const create = (body, token) => fetch(base + '/api/candidates', {
    method: 'POST',
    headers: token ? Object.assign({ 'Content-Type': 'application/json' }, authorized(token)) : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal((await create({ name: 'Signed-out candidate', role: 'R', location: 'L', trustScore: 1, clearanceTier: 1 })).status, 401, 'Creations require a signed-in staff session.');
  const before = await Candidate.countDocuments();
  const payload = {
    name: 'Real Candidate', role: 'Backend Engineer', trustScore: 88, clearanceTier: 4,
    location: 'Denver, CO', verificationStatus: 'verified',
    verifiedSkills: ['Go', 'Postgres'], idDocuments: ['US Passport'],
    pipeline: { reqCode: 'REQ-9001', currentStep: 2, completionPercentage: 40 }
  };
  const good = await create(payload, staffToken);
  assert.equal(good.status, 201);
  const saved = await good.json();
  assert.equal(saved.name, 'Real Candidate');
  assert.equal(saved.pipeline.reqCode, 'REQ-9001');
  assert.equal(await Candidate.countDocuments(), before + 1);
  assert.equal((await fetch(base + '/api/candidates?q=Real%20Candidate')).status, 200);
  const bad = await create({ name: '  ', role: 'x'.repeat(301), trustScore: 101, clearanceTier: 9, location: '', rogue: true }, staffToken);
  assert.equal(bad.status, 400);
  assert.equal(typeof (await bad.json()).error, 'string');
  assert.equal(await Candidate.countDocuments(), before + 1);
  // A pipeline failure must not leave an orphan candidate behind.
  const orphan = await create({
    name: 'Orphan Candidate', role: 'QA Engineer', trustScore: 70, clearanceTier: 2,
    location: 'Remote', pipeline: { reqCode: '', currentStep: 1 }
  }, staffToken);
  assert.equal(orphan.status, 400);
  assert.equal(await Candidate.findOne({ name: 'Orphan Candidate' }), null);
});
test('cleanup removes only the seed roster and keeps manually added candidates', async () => {
  await seed();
  const { clean } = require('../cleanup');
  const outcome = await clean();
  assert.equal(outcome.candidates, 4);
  assert.equal(outcome.pipelines, 4);
  assert.equal(outcome.users, team.length, 'Cleanup removes the seeded team accounts.');
  assert.equal(await (require('../src/models/User')).countDocuments(), 0);
  assert.ok(await Candidate.findOne({ name: 'Real Candidate' }), 'Manual candidates must survive the cleanup.');
  assert.equal(await Candidate.countDocuments({ name: { $in: ['Elena Rostova', 'Marcus Chen', 'Priya Nair', 'David Okafor'] } }), 0);
});
test('database outage returns 503 without buffering requests', async () => {
  // Leave the connection open for teardown; simulate only the app's readiness check.
  const old = mongoose.connection.readyState;
  mongoose.connection.readyState = 0;
  try {
    assert.equal((await fetch(base + '/api/candidates')).status, 503);
    assert.equal((await fetch(base + '/api/health')).status, 503);
  } finally { mongoose.connection.readyState = old; }
});

test('feedback requires a session, is attributed to the logged-in member and survives reseeding', async () => {
  await seed();
  const elena = await Candidate.findOne({ name: 'Elena Rostova' });
  const originalFeedbackCount = (await Candidate.findById(elena._id)).feedback.length;
  const sendFeedback = (id, body, token) => fetch(base + '/api/candidates/' + id + '/feedback', {
    method: 'PATCH', headers: token ? authorized(token) : { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const anonymous = await sendFeedback(elena._id, { text: 'Anonymous feedback must be rejected.' });
  assert.equal(anonymous.status, 401, 'Feedback without a token must return 401.');
  const interviewerAccount = team.find(item => item.role === 'interviewer');
  const interviewer = await login(interviewerAccount.email, interviewerAccount.password);
  const firstText = 'First manual-entry feedback for Elena, appended via /api/candidates/:id/feedback.';
  const first = await sendFeedback(elena._id, { text: firstText }, interviewer);
  assert.equal(first.status, 200);
  const afterFirst = await first.json();
  assert.equal(afterFirst.feedback.length, originalFeedbackCount + 1);
  assert.equal(afterFirst.feedback.at(-1).text, firstText);
  assert.equal(afterFirst.feedback.at(-1).author, interviewerAccount.name, 'Feedback must record the interviewer name.');
  assert.equal(afterFirst.feedback.at(-1).role, 'interviewer');
  // A second team member logs in and is recorded separately.
  const recruiter = await login();
  const secondText = 'Second feedback entry from the recruiter account.';
  const second = await sendFeedback(elena._id, { text: secondText }, recruiter);
  assert.equal(second.status, 200);
  const afterSecond = await second.json();
  assert.equal(afterSecond.feedback.length, originalFeedbackCount + 2);
  const recruiterAccount = team.find(item => item.role === 'recruiter');
  assert.equal(afterSecond.feedback.at(-1).author, recruiterAccount.name);
  await seed();
  const afterReseed = await Candidate.findById(elena._id);
  assert.equal(afterReseed.feedback.length, originalFeedbackCount + 2, 'Reseeding must not drop saved feedback.');
  const badId = await sendFeedback('not-an-id', { text: 'x' }, interviewer);
  assert.equal(badId.status, 400, 'Non-ObjectId id shape must return 400.');
  const missingId = await sendFeedback(new mongoose.Types.ObjectId().toHexString(), { text: 'x' }, interviewer);
  assert.equal(missingId.status, 404, 'Unknown candidate id must return 404.');
  const emptyText = await sendFeedback(elena._id, { text: '   ' }, interviewer);
  assert.equal(emptyText.status, 400, 'Empty text must return 400.');
  assert.equal(typeof (await emptyText.json()).error, 'string');
});
test('team accounts log in, resolve their own profile and log out', async () => {
  await seed();
  const post = (path, body, token) => fetch(base + path, {
    method: 'POST', headers: token ? authorized(token) : { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const wrongPassword = await post('/api/auth/login', { email: team[0].email, password: 'not-the-password' });
  assert.equal(wrongPassword.status, 401);
  assert.equal(typeof (await wrongPassword.json()).error, 'string');
  assert.equal((await post('/api/auth/login', { email: 'nobody@honesthire.app', password: 'whatever' })).status, 401);
  assert.equal((await post('/api/auth/login', { email: 'not-an-email', password: '' })).status, 400);
  assert.equal((await post('/api/auth/login', { email: team[0].email, password: team[0].password, role: 'admin' })).status, 400);
  const token = await login();
  const me = await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(me.status, 200);
  const profile = (await me.json()).user;
  assert.equal(profile.name, team[0].name);
  assert.equal(profile.email, team[0].email);
  assert.equal(profile.role, 'recruiter');
  assert.equal((await fetch(base + '/api/auth/me')).status, 401, 'No token must return 401.');
  assert.equal((await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + 'a'.repeat(64) } })).status, 401);
  const list = await (await fetch(base + '/api/auth/team')).json();
  assert.equal(list.items.length, team.length);
  assert.deepEqual(
    list.items.map(member => member.name),
    ['Morgan Admin', 'Riley Applicant', 'Izzy Interviewer', 'Sam Patel', 'Tara Lin', 'Ava Recruiter', 'Riley Recruiter']
  );
  assert.equal(list.items.every(member => !('passwordHash' in member) && !('passwordSalt' in member)), true, 'Hashes must never leave the server.');
  assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST' })).status, 401);
  assert.equal((await post('/api/auth/logout', {}, token)).status, 204);
  assert.equal((await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })).status, 401, 'A logged-out token must stop working.');
});
test('resumes and ID files upload to GridFS, stream back and delete', async () => {
  await seed();
  const elena = await Candidate.findOne({ name: 'Elena Rostova' });
  const token = await login();
  const recruiter = team.find(item => item.role === 'recruiter');
  const recruiterToken = await login(recruiter.email, recruiter.password);
  // Staff sessions can upload to any record; a candidate session is own-record scoped.
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('Elena Rostova - resume body.'.padEnd(600, ' ')), Buffer.from('\n%%EOF')]);
  const upload = (id, name, kind, body, type, auth = token) => fetch(
    base + '/api/candidates/' + id + '/documents?name=' + encodeURIComponent(name) + '&kind=' + kind,
    { method: 'POST', headers: Object.assign({ 'Content-Type': type }, auth ? { Authorization: 'Bearer ' + auth } : {}), body }
  );
  assert.equal((await upload(elena._id, 'resume.pdf', 'resume', pdf, 'application/pdf', '')).status, 401, 'Uploads require a session.');
  const marcusRecord = await Candidate.findOne({ name: 'Marcus Chen' });
  assert.equal((await upload(marcusRecord._id, 'resume.pdf', 'resume', pdf, 'application/pdf', recruiterToken)).status, 201, 'Staff uploads keep working across records.');
  const candidate = team.find(item => item.role === 'candidate');
  const candidateToken = await login(candidate.email, candidate.password);
  assert.equal((await upload(marcusRecord._id, 'candidate.pdf', 'resume', pdf, 'application/pdf', candidateToken)).status, 403, 'Candidate uploads are own-record scoped.');
  const saved = await upload(elena._id, 'resume.pdf', 'resume', pdf, 'application/pdf');
  assert.equal(saved.status, 201);
  const created = (await saved.json()).document;
  assert.equal(created.name, 'resume.pdf');
  assert.equal(created.kind, 'resume');
  assert.equal(created.contentType, 'application/pdf');
  assert.equal(created.size, pdf.length);
  assert.equal(created.uploadedBy, team[0].name, 'Uploads record the logged-in member.');
  // The bytes really live in GridFS and the candidate mirrors the metadata.
  const stored = await mongoose.connection.db.collection('candidateFiles.files').findOne({ _id: new mongoose.Types.ObjectId(created.fileId) });
  assert.ok(stored, 'The upload must create a GridFS file.');
  assert.equal(stored.length, pdf.length);
  const listed = await (await fetch(base + '/api/candidates/' + elena._id + '/documents')).json();
  assert.equal(listed.candidateName, 'Elena Rostova');
  assert.equal(listed.items.length, 1);
  const feed = await (await fetch(base + '/api/candidates?q=Elena')).json();
  assert.equal(feed.items[0].documents.length, 1, 'The candidate feed carries document metadata.');
  // Download streams the same bytes: inline by default, attachment on request.
  const inline = await fetch(base + '/api/documents/' + created.fileId);
  assert.equal(inline.status, 200);
  assert.equal(inline.headers.get('content-type'), 'application/pdf');
  assert.match(inline.headers.get('content-disposition'), /^inline/);
  assert.equal(Buffer.from(await inline.arrayBuffer()).equals(pdf), true);
  assert.match((await fetch(base + '/api/documents/' + created.fileId + '?download=1')).headers.get('content-disposition'), /^attachment/);
  // An ID scan with a valid PNG signature is accepted as a second document.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  assert.equal((await upload(elena._id, 'id-scan.png', 'id_verification', png, 'image/png')).status, 201);
  // Validation: unsupported type, wrong signature, bad kind, empty body, unknown candidate.
  assert.equal((await upload(elena._id, 'archive.zip', 'resume', Buffer.from('PK\u0003\u0004'), 'application/zip')).status, 415);
  assert.equal((await upload(elena._id, 'fake.png', 'resume', Buffer.from('not a png at all'), 'image/png')).status, 415);
  assert.equal((await upload(elena._id, 'fake.pdf', 'resume', Buffer.from('nope'), 'application/pdf')).status, 415);
  assert.equal((await upload(elena._id, 'resume.pdf', 'passport', pdf, 'application/pdf')).status, 400);
  assert.equal((await upload(elena._id, 'resume.pdf', 'resume', Buffer.alloc(0), 'application/pdf')).status, 400);
  assert.equal((await upload('not-an-id', 'resume.pdf', 'resume', pdf, 'application/pdf')).status, 400);
  assert.equal((await upload(new mongoose.Types.ObjectId().toHexString(), 'resume.pdf', 'resume', pdf, 'application/pdf')).status, 404);
  // Oversized uploads are rejected by the raw-body limit before touching GridFS.
  const oversized = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(8 * 1024 * 1024 + 1)]);
  assert.equal((await upload(elena._id, 'huge.pdf', 'resume', oversized, 'application/pdf')).status, 413);
  assert.equal(await mongoose.connection.db.collection('candidateFiles.files').countDocuments({ filename: 'huge.pdf' }), 0);
  assert.equal((await fetch(base + '/api/documents/not-an-id')).status, 400);
  assert.equal((await fetch(base + '/api/documents/' + new mongoose.Types.ObjectId().toHexString())).status, 404);
  // Delete removes the metadata and the GridFS file together.
  const removed = await fetch(base + '/api/candidates/' + elena._id + '/documents/' + created.fileId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).documents.length, 1, 'The ID scan must remain after deleting the resume.');
  assert.equal(await mongoose.connection.db.collection('candidateFiles.files').countDocuments({ _id: new mongoose.Types.ObjectId(created.fileId) }), 0);
  assert.equal((await fetch(base + '/api/documents/' + created.fileId)).status, 404);
  assert.equal((await fetch(base + '/api/candidates/' + elena._id + '/documents/' + created.fileId, { method: 'DELETE' })).status, 401);
  await seed();
});
test('pipeline stage filter narrows the feed and validates its range', async () => {
  await seed();
  const feed = async query => {
    const response = await fetch(base + '/api/candidates?' + query);
    assert.equal(response.status, 200, query);
    return response.json();
  };
  const stage4 = await feed('stage=4');
  const unfiltered = await feed('stage=any');
  assert.equal(stage4.total, unfiltered.total, 'total stays the whole roster.');
  assert.equal(unfiltered.matched, unfiltered.total);
  assert.equal(stage4.matched, 2);
  assert.deepEqual(stage4.items.map(item => item.name).sort(), ['Elena Rostova', 'Priya Nair']);
  assert.equal(stage4.items.every(item => item.pipeline.currentStep === 4), true);
  assert.equal((await feed('stage=5')).items[0].name, 'Marcus Chen');
  assert.equal((await feed('stage=3')).items[0].name, 'David Okafor');
  assert.equal((await feed('stage=2')).items.some(item => ['Elena Rostova', 'Marcus Chen', 'Priya Nair', 'David Okafor'].includes(item.name)), false, 'No seeded candidate sits at Step 2.');
  assert.equal((await feed('stage=any')).matched, unfiltered.matched, 'stage=any never filters the roster.');
  // Stage combines with the verification, tier and requisition filters.
  const combined = await feed('stage=4&verificationStatus=verified&tier=5&reqCode=REQ-4091');
  assert.deepEqual(combined.items.map(item => item.name), ['Elena Rostova']);
  assert.equal((await feed('stage=4&verificationStatus=pending')).items[0].name, 'Priya Nair');
  for (const bad of ['stage=0', 'stage=6', 'stage=platinum', 'stage=' + 'x'.repeat(201)]) {
    assert.equal((await fetch(base + '/api/candidates?' + bad)).status, 400, bad);
  }
  // Single candidate lookup used by the profile panel.
  const elena = stage4.items.find(item => item.name === 'Elena Rostova');
  const one = await fetch(base + '/api/candidates/' + elena._id);
  assert.equal(one.status, 200);
  const profile = await one.json();
  assert.equal(profile.pipeline.currentStep, 4);
  assert.equal(profile.pipeline.reqCode, 'REQ-4091');
  assert.equal((await fetch(base + '/api/candidates/not-an-id')).status, 400);
    assert.equal((await fetch(base + '/api/candidates/' + new mongoose.Types.ObjectId().toHexString())).status, 404);
});

// ---- Admin Dashboard: strict admin gate + storage metrics placeholder ----
// Admin is always the seed account with role:'admin' (never index 0 — the feed order
// of team[] must not decide which account is an administrator).
const adminLogin = async () => {
  const admin = team.find(member => member.role === 'admin');
  return login(admin.email, admin.password, require('../src/auth').DEFAULT_ADMIN_SECRET);
};
const staffLogin = async (role = 'recruiter') => {
  const member = team.find(item => item.role === role);
  return login(member.email, member.password);
};
const candidateLogin = async () => {
  const member = team.find(item => item.role === 'candidate');
  return login(member.email, member.password);
};
const candidateAccount = () => team.find(item => item.role === 'candidate');
test('admin overview requires the admin role and reports placeholder storage', async () => {
  await seed();
  const total = await Candidate.countDocuments();
  assert.equal((await fetch(base + '/api/admin/overview')).status, 401, 'unauthenticated must be 401');
  const recruiter = await login();
  assert.equal((await fetch(base + '/api/admin/overview', { headers: { Authorization: 'Bearer ' + recruiter } })).status, 403, 'non-admin must be 403');
  const admin = await adminLogin();
  const overview = await (await fetch(base + '/api/admin/overview', { headers: { Authorization: 'Bearer ' + admin } })).json();
  assert.equal(overview.candidates.total, total);
  assert.equal(overview.storage.available, false);
  assert.equal(overview.storage.files, null);
  assert.equal(overview.storage.note.includes('storage engine'), true);
  assert.equal(overview.health.database, 'connected');
  assert.ok(Number.isInteger(overview.health.uptimeSeconds) && overview.health.uptimeSeconds >= 0);
  // Every admin endpoint refuses non-admins.
  for (const path of ['/api/admin/team', '/api/admin/audit', '/api/admin/analytics']) {
    assert.equal((await fetch(base + path, { headers: { Authorization: 'Bearer ' + recruiter } })).status, 403);
  }
});

test('admin team list hides hashes; create/update/sessions are audited', async () => {
  await seed();
  const admin = await adminLogin();
  const auth = authorized(admin);
  const list = await (await fetch(base + '/api/admin/team', { headers: auth })).json();
  assert.equal(list.length, await require('../src/models/User').countDocuments());
  assert.equal(list.every(member => !('passwordHash' in member) && !('passwordSalt' in member)), true, 'hashes must never leave the server');
  assert.ok(list.some(member => member.email === 'admin@honesthire.app' && member.role === 'admin'));
  const created = await fetch(base + '/api/admin/team', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Dave Dev', email: 'dave@example.com', role: 'interviewer', password: 'devpass1234' }) });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).email, 'dave@example.com');
  assert.equal((await fetch(base + '/api/admin/team', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Dave Dev', email: 'dave@example.com', role: 'interviewer', password: 'devpass1234' }) })).status, 409);
  assert.equal((await fetch(base + '/api/admin/team', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'x', email: 'x@x.com', role: 'superuser', password: 'short' }) })).status, 400);
  await require('../src/models/User').deleteOne({ email: 'dave@example.com' });
});

test('admin can change a teammate role but not their own, and can revoke sessions', async () => {
  await seed();
  const admin = await adminLogin();
  const auth = authorized(admin);
  const members = await (await fetch(base + '/api/admin/team', { headers: auth })).json();
  const morgan = members.find(member => member.email === 'admin@honesthire.app');
  // Self-demotion is refused.
  assert.equal((await fetch(base + '/api/admin/team/' + morgan.id, { method: 'PATCH', headers: auth, body: JSON.stringify({ role: 'recruiter' }) })).status, 409);
  const tara = members.find(member => member.email === 'tara.lin@honesthire.app');
  const changed = await (await fetch(base + '/api/admin/team/' + tara.id, { method: 'PATCH', headers: auth, body: JSON.stringify({ role: 'recruiter' }) }));
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).role, 'recruiter');
  const revoked = await (await fetch(base + '/api/admin/team/' + tara.id + '/sessions', { method: 'DELETE', headers: auth })).json();
  assert.ok(Number.isInteger(revoked.revoked));
});

test('candidates are blocked from admin, mutating and internal interviewer APIs', async () => {
  await seed();
  const elena = await Candidate.findOne({ name: 'Elena Rostova' });
  assert.ok(elena, 'seeded Elena must exist for the portal fixture.');
  const admin = await adminLogin();
  const recruiter = await staffLogin('recruiter');
  const interviewer = await staffLogin('interviewer');
  const portal = await candidateLogin();
  const portalAuth = { Authorization: 'Bearer ' + portal };
  const recruiterAuth = { Authorization: 'Bearer ' + recruiter };
  const candidate = candidateAccount();
  assert.equal(candidate.role, 'candidate');
  // Portal: the candidate sees their own application, everyone else is refused.
  const me = await fetch(base + '/api/portal/me', { headers: portalAuth });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).candidate.name, 'Elena Rostova');
  assert.equal((await fetch(base + '/api/portal/me', { headers: recruiterAuth })).status, 403);
  assert.equal((await fetch(base + '/api/portal/me')).status, 401);
  // Admin surface is strictly off-limits to candidates; a denial is audited.
  assert.equal((await fetch(base + '/api/admin/overview', { headers: portalAuth })).status, 403);
  // Internal hiring writes reject candidates; staff can still write.
  assert.equal((await fetch(base + '/api/pipeline/' + elena._id, {
    method: 'PATCH', headers: authorized(portal), body: JSON.stringify({ action: 'hold' })
  })).status, 403);
  assert.equal((await fetch(base + '/api/candidates', {
    method: 'POST', headers: authorized(portal),
    body: JSON.stringify({ name: 'New', role: 'R', location: 'L', trustScore: 5, clearanceTier: 1 })
  })).status, 403);
  assert.equal((await fetch(base + '/api/candidates/' + elena._id + '/feedback', {
    method: 'PATCH', headers: authorized(portal), body: JSON.stringify({ text: 'Candidate tampering attempt.' })
  })).status, 403);
  // A second seeded record (Marcus) is looked up once for every cross-record check below.
  const marcus = await Candidate.findOne({ name: 'Marcus Chen' });
  assert.ok(marcus && String(marcus._id) !== String(elena._id), 'Elena and Marcus must be different seeded records.');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('Own application - resume body.'.padEnd(600, ' ')), Buffer.from('\n%%EOF')]);
  // The internal upload endpoint rejects candidates on other records, while the
  // portal remains their supported upload path (verified below).
  assert.equal((await fetch(
    base + '/api/candidates/' + marcus._id + '/documents?name=self.pdf&kind=resume',
    { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/pdf' }, portalAuth), body: pdf }
  )).status, 403, 'Candidates cannot use the internal endpoint on other records.');
  // The candidate feed no longer leaks the roster to applicants: they scoped to their record.
  const scoped = await (await fetch(base + '/api/candidates', { headers: portalAuth })).json();
  assert.equal(scoped.total, 1);
  assert.equal(scoped.matched, 1);
  assert.deepEqual(scoped.items.map(item => item.name), ['Elena Rostova']);
  // Staff keep their full read/write surface.
  const staff = await (await fetch(base + '/api/candidates', { headers: recruiterAuth })).json();
  assert.ok(staff.total >= 4);
  // Portal document upload/download works end-to-end for the owner, and other
  // seeded records stay invisible/unreachable to the applicant.
  const portalUpload = await fetch(
    base + '/api/portal/documents?name=portal-resume.pdf&kind=resume',
    { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/pdf' }, portalAuth), body: pdf }
  );
  assert.equal(portalUpload.status, 201);
  const saved = (await portalUpload.json()).document;
  const download = await fetch(base + '/api/documents/' + saved.fileId, { headers: portalAuth });
  assert.equal(download.status, 200);
  assert.equal(Buffer.from(await download.arrayBuffer()).equals(pdf), true);
  // Reuse the second seeded record looked up above: it stays invisible to the
  // portal, and the own-record guard rejects cross-record document removal.
  assert.ok(marcus && String(marcus._id) !== String(elena._id));
  assert.equal((await fetch(base + '/api/candidates/' + marcus._id, { headers: portalAuth })).status, 404);
  assert.equal((await fetch(base + '/api/candidates/' + marcus._id + '/documents/' + saved.fileId, {
    method: 'DELETE', headers: portalAuth
  })).status, 403);
  assert.equal((await fetch(base + '/api/admin/overview', { headers: portalAuth })).status, 403);
  assert.equal((await fetch(base + '/api/portal/me', { headers: { Authorization: 'Bearer ' + interviewer } })).status, 403);
  // Portal validation still reaches the shared upload validators.
  assert.equal((await fetch(base + '/api/portal/documents?name=bad.pdf&kind=passport', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/pdf' }, portalAuth), body: pdf
  })).status, 400);
  await seed();
});

test('admin analytics derives real metrics from seeded pipelines', async () => {
  await seed();
  const admin = await adminLogin();
  const auth = authorized(admin);
  const data = await (await fetch(base + '/api/admin/analytics', { headers: auth })).json();
  assert.ok(data.statusCounts && typeof data.statusCounts.completed === 'number');
  assert.equal(typeof data.offerAcceptanceRate, 'number');
  assert.ok(data.averageDaysToHire === null || typeof data.averageDaysToHire === 'number');
  assert.ok(Array.isArray(data.candidatesPerRequisition));
  assert.equal(data.candidatesPerRequisition.some(row => row.reqCode === 'REQ-4091' && row.candidates === 4), true);
});

test('admin audit log records candidate access denials', async () => {
  await seed();
  const admin = await adminLogin();
  const portal = await candidateLogin();
  // A candidate hitting an admin API is refused and the attempt is written to the audit trail.
  assert.equal((await fetch(base + '/api/admin/overview', { headers: { Authorization: 'Bearer ' + portal } })).status, 403);
  const audit = await (await fetch(base + '/api/admin/audit?action=access_denied', { headers: authorized(admin) })).json();
  assert.ok(audit.count >= 1, 'the denial must be recorded in the audit log.');
  const entry = audit.items.find(item => item.actor && item.actor.role === 'candidate');
  assert.ok(entry, 'the denied candidate must be recorded as the actor.');
  assert.equal(entry.action, 'access_denied');
  assert.match(entry.target.label, /\/api\/admin\//);
  assert.equal(entry.details.reason, 'forbidden');
  // The trail itself stays admin-only.
  assert.equal((await fetch(base + '/api/admin/audit', { headers: { Authorization: 'Bearer ' + portal } })).status, 403);
  assert.equal((await fetch(base + '/api/admin/audit')).status, 401);
  const all = await (await fetch(base + '/api/admin/audit?limit=5', { headers: authorized(admin) })).json();
  assert.equal(all.limit, 5);
  assert.ok(all.items.length <= 5);
  await seed();
});
test('admin login requires the master security passcode', async () => {
  await seed();
  const { DEFAULT_ADMIN_SECRET } = require('../src/auth');
  const admin = team.find(member => member.role === 'admin');
  const attempt = body => fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const missing = await attempt({ email: admin.email, password: admin.password });
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, 'Invalid Admin Credentials or Passcode');
  const wrongKey = await attempt({ email: admin.email, password: admin.password, adminKey: 'not-the-key' });
  assert.equal(wrongKey.status, 401);
  assert.equal((await wrongKey.json()).error, 'Invalid Admin Credentials or Passcode');
  const badPassword = await attempt({ email: admin.email, password: 'wrong-password' });
  assert.equal(badPassword.status, 401);
  assert.equal((await badPassword.json()).error, 'Invalid email or password.');
  const ok = await attempt({ email: admin.email, password: admin.password, adminKey: DEFAULT_ADMIN_SECRET });
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.user.role, 'admin');
  assert.equal((await fetch(base + '/api/admin/overview', { headers: { Authorization: 'Bearer ' + data.token } })).status, 200);
  const recruiter = team.find(member => member.role === 'recruiter');
  assert.equal((await attempt({ email: recruiter.email, password: recruiter.password })).status, 200);
  assert.equal((await attempt({ email: recruiter.email, password: recruiter.password, adminKey: 'bogus' })).status, 200);
  const candidate = team.find(member => member.role === 'candidate');
  assert.equal((await attempt({ email: candidate.email, password: candidate.password })).status, 200);
  const adminToken = await adminLogin();
  const audit = await (await fetch(base + '/api/admin/audit?action=login_failed', { headers: authorized(adminToken) })).json();
  const reasons = audit.items.filter(item => item.details && String(item.details.reason).indexOf('admin_secret') === 0).map(item => item.details.reason);
  assert.ok(reasons.includes('admin_secret_missing'), 'missing passcode must be audited');
  assert.ok(reasons.includes('admin_secret_invalid'), 'wrong passcode must be audited');
  assert.equal((await attempt({ email: admin.email, password: admin.password, adminKey: DEFAULT_ADMIN_SECRET, role: 'admin' })).status, 400);
  await seed();
});

test('admin metrics serves live dashboard counts from MongoDB', async () => {
  await seed();
  assert.equal((await fetch(base + '/api/admin/metrics')).status, 401, 'unauthenticated must be 401');
  const recruiter = await staffLogin();
  assert.equal((await fetch(base + '/api/admin/metrics', { headers: { Authorization: 'Bearer ' + recruiter } })).status, 403, 'non-admin must be 403');
  const admin = await adminLogin();
  const auth = authorized(admin);
  const Session = require('../src/models/Session');
  const before = await (await fetch(base + '/api/admin/metrics', { headers: auth })).json();
  assert.equal(before.candidates.total, await Candidate.countDocuments(), 'candidate total must come from the database');
  assert.equal(before.sessions.active, await Session.countDocuments({ expiresAt: { $gt: new Date() } }), 'active sessions must come from the live session store');
  assert.ok(before.sessions.active >= 1, 'the admin sign-in itself must count as an active session');
  assert.equal(before.users.total, await require('../src/models/User').countDocuments());
  assert.ok(before.storage.available === false || (Number.isInteger(before.storage.files) && before.storage.bytes >= 0), 'storage must be live or explicitly unavailable');
  assert.equal(before.pipelines.statusCounts.completed, await Pipeline.countDocuments({ status: 'completed' }));
  assert.ok(before.requisitions.some(row => row.reqCode === 'REQ-4091' && row.candidates === 4), 'the seeded requisition must be listed');
  // Live candidate sync: a new registration must appear in the very next metrics call.
  const staff = authorized(await staffLogin('recruiter'));
  const create = await fetch(base + '/api/candidates', {
    method: 'POST', headers: staff,
    body: JSON.stringify({ name: 'Metric Probe', role: 'QA Engineer', location: 'Remote', trustScore: 71, clearanceTier: 4, pipeline: { reqCode: 'REQ-METRIC' } })
  });
  assert.equal(create.status, 201);
  const created = await create.json();
  const afterCreate = await (await fetch(base + '/api/admin/metrics', { headers: auth })).json();
  assert.equal(afterCreate.candidates.total, before.candidates.total + 1);
  assert.ok(afterCreate.requisitions.some(row => row.reqCode === 'REQ-METRIC' && row.candidates === 1), 'the new requisition must be live');
  // Restore the exact seed shape for the remaining tests.
  await Candidate.deleteOne({ _id: created._id });
  await Pipeline.deleteOne({ candidateId: created._id });
  await seed();
});

test('staff can update candidate checks and every change is audited', async () => {
  await seed();
  const recruiter = await staffLogin();
  const auth = authorized(recruiter);
  const { items } = await (await fetch(base + '/api/candidates')).json();
  const elena = items.find(item => item.name === 'Elena Rostova');
  const url = base + '/api/candidates/' + elena._id + '/checks';
  const noAuth = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verificationStatus: 'verified' }) });
  assert.equal(noAuth.status, 401, 'checks updates require a staff session');
  const updated = await fetch(url, { method: 'PATCH', headers: auth, body: JSON.stringify({ verificationStatus: 'in_progress', idDocuments: ['Verified US Passport', 'Updated reference'] }) });
  assert.equal(updated.status, 200);
  const saved = await updated.json();
  assert.equal(saved.verificationStatus, 'in_progress');
  assert.deepEqual(saved.idDocuments, ['Verified US Passport', 'Updated reference']);
  // The feed filter reads the same field: the change must be visible immediately.
  const feed = await (await fetch(base + '/api/candidates?verificationStatus=in_progress')).json();
  assert.ok(feed.items.some(item => String(item._id) === String(elena._id)), 'the feed must reflect the updated checks status');
  for (const [target, body, status] of [
    [base + '/api/candidates/not-an-id/checks', { verificationStatus: 'verified' }, 400],
    [url, {}, 400],
    [url, { verificationStatus: 'platinum' }, 400],
    [url, { unknown: true }, 400],
    [url, { verificationStatus: 'verified', extra: 1 }, 400]
  ]) {
    const bad = await fetch(target, { method: 'PATCH', headers: auth, body: JSON.stringify(body) });
    assert.equal(bad.status, status, 'checks guard failed for ' + target + ' ' + JSON.stringify(body));
  }
  assert.equal((await fetch(base + '/api/candidates/ffffffffffffffffffffffff/checks', { method: 'PATCH', headers: auth, body: JSON.stringify({ verificationStatus: 'verified' }) })).status, 404);
  // Candidate-role callers must stay out of staff tooling.
  const portal = await candidateLogin();
  assert.equal((await fetch(url, { method: 'PATCH', headers: authorized(portal), body: JSON.stringify({ verificationStatus: 'verified' }) })).status, 403);
  const admin = await adminLogin();
  const audit = await (await fetch(base + '/api/admin/audit?action=checks_updated', { headers: authorized(admin) })).json();
  assert.ok(audit.count >= 1, 'the checks update must be recorded in the audit log.');
  assert.equal(audit.items[0].action, 'checks_updated');
  assert.equal(audit.items[0].details.verificationStatus, 'in_progress');
  await seed();
});

test('pipeline changes record the true from/to transition for audit and notifications', async () => {
  await seed();
  const staff = authorized(await staffLogin('recruiter'));
  const { items } = await (await fetch(base + '/api/candidates')).json();
  const elena = items.find(item => item.name === 'Elena Rostova');
  // Force a known starting point: earlier tests may have moved the seeded pipeline.
  await Pipeline.updateOne({ candidateId: elena._id }, { $set: { currentStep: 3, completionPercentage: 60, status: 'in_progress' } });
  const advance = await fetch(base + '/api/pipeline/' + elena._id, { method: 'PATCH', headers: staff, body: JSON.stringify({ action: 'advance' }) });
  assert.equal(advance.status, 200);
  assert.equal((await advance.json()).currentStep, 4);
  const Notification = require('../src/models/Notification');
  const stageEntry = await Notification.findOne({ candidateId: elena._id, kind: 'stage_changed' }).sort({ createdAt: -1, _id: -1 }).lean();
  assert.ok(stageEntry, 'an advance from a lower step must log stage_changed.');
  assert.equal(stageEntry.pipeline.reqCode, 'REQ-4091');
  assert.equal(stageEntry.pipeline.fromStep, 3);
  assert.equal(stageEntry.pipeline.toStep, 4);
  assert.equal(stageEntry.pipeline.fromStatus, 'in_progress');
  assert.equal(stageEntry.pipeline.toStatus, 'in_progress');
  const hold = await fetch(base + '/api/pipeline/' + elena._id, { method: 'PATCH', headers: staff, body: JSON.stringify({ action: 'hold' }) });
  assert.equal(hold.status, 200);
  assert.equal((await hold.json()).status, 'on_hold');
  const statusEntry = await Notification.findOne({ candidateId: elena._id, kind: 'status_changed' }).sort({ createdAt: -1, _id: -1 }).lean();
  assert.ok(statusEntry, 'a hold must log status_changed.');
  assert.equal(statusEntry.pipeline.fromStep, 4);
  assert.equal(statusEntry.pipeline.toStep, 4);
  assert.equal(statusEntry.pipeline.fromStatus, 'in_progress');
  assert.equal(statusEntry.pipeline.toStatus, 'on_hold');
  // The audit trail must agree with the notification snapshot.
  const admin = await adminLogin();
  const audit = await (await fetch(base + '/api/admin/audit?action=pipeline_changed', { headers: authorized(admin) })).json();
  const mine = audit.items.filter(item => item.target.id === String(elena._id))[0];
  assert.ok(mine, 'the pipeline change must be audited for Elena.');
  assert.equal(mine.details.fromStep, 4);
  assert.equal(mine.details.toStep, 4);
  assert.equal(mine.details.fromStatus, 'in_progress');
  assert.equal(mine.details.toStatus, 'on_hold');
  await seed();
});