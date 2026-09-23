'use strict';
const DOCUMENT_KINDS = ['resume', 'id_verification', 'other'];
const VERIFICATION_STATUSES = ['verified', 'in_progress', 'pending'];
const PIPELINE_STATUSES = ['pending', 'in_progress', 'completed', 'on_hold', 'rejected'];
// Roles drive authorization across the API and UI. 'candidate' is an external
// applicant scoped to their own record (see requireCandidate / requireOwnCandidate).
const ROLES = ['admin', 'recruiter', 'interviewer', 'candidate'];
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Expected a JSON object.');
}
function candidateInput(body, partial = false) {
  object(body);
  const textFields = ['name', 'email', 'role', 'requisition', 'skills', 'summary'];
  const numbers = { trustScore: [0, 100], tier: [1, 5], checksProgress: [0, 100] };
  const allowed = [...textFields, ...Object.keys(numbers)];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new HttpError(400, 'Unknown candidate field.');
  if (!partial && ['name', 'email', 'role'].some(key => !body[key])) throw new HttpError(400, 'name, email and role are required.');
  const data = {};
  for (const key of textFields) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'string' || body[key].length > 2000) throw new HttpError(400, `${key} must be a string of at most 2000 characters.`);
    data[key] = body[key].trim();
    if (['name', 'email', 'role', 'requisition'].includes(key) && !data[key]) throw new HttpError(400, `${key} cannot be empty.`);
  }
  if (data.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new HttpError(400, 'Invalid email.');
    data.email = data.email.toLowerCase();
  }
  for (const [key, [min, max]] of Object.entries(numbers)) {
    if (body[key] === undefined) continue;
    if (!Number.isInteger(body[key]) || body[key] < min || body[key] > max) throw new HttpError(400, `${key} must be an integer from ${min} to ${max}.`);
    data[key] = body[key];
  }
  if (partial && !Object.keys(data).length) throw new HttpError(400, 'Provide at least one field.');
  return data;
}
function emailField(value, { required = false, field = 'email', max = 200 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return '';
    throw new HttpError(400, field + ' is required.');
  }
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, `${field} must be a string of at most ${max} characters.`);
  const email = value.trim().toLowerCase();
  if (!email || (required && !email)) throw new HttpError(400, field + ' cannot be empty.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Invalid email.');
  return email;
}
function analyticsInput(query) {
  if (!query || typeof query !== 'object') throw new HttpError(400, 'Invalid query.');
  const allowed = ['reqCode'];
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string' || !value.trim() || value.length > 100) {
      throw new HttpError(400, 'Invalid query parameter: ' + key);
    }
  }
  return { reqCode: typeof query.reqCode === 'string' && query.reqCode.trim() ? query.reqCode.trim() : '' };
}
function notificationsInput(query) {
  if (!query || typeof query !== 'object') throw new HttpError(400, 'Invalid query.');
  const allowed = ['limit'];
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string' || !value.trim()) {
      throw new HttpError(400, 'Invalid query parameter: ' + key);
    }
  }
  const raw = typeof query.limit === 'string' ? query.limit.trim() : '';
  if (raw && (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 200)) throw new HttpError(400, 'limit must be 1–200.');
  return { limit: raw ? Number(raw) : 50 };
}
function feedbackInput(body) {
  object(body);
  if (Object.keys(body).length !== 1 || typeof body.text !== 'string') throw new HttpError(400, 'Provide exactly one field: text.');
  const text = body.text.trim();
  if (!text) throw new HttpError(400, 'Feedback text cannot be empty.');
  if (body.text.length > 2000) throw new HttpError(400, 'Feedback text must be at most 2000 characters.');
  return { text };
}
// Staff background-checks update: verification status and/or the ID documents on
// file. Both persist on the candidate record that the feed filter and the admin
// metrics read back from, so a change is visible everywhere on the next call.
function checksInput(body) {
  object(body);
  const allowed = ['verificationStatus', 'idDocuments'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new HttpError(400, 'Unknown checks field.');
  const data = {};
  if (body.verificationStatus !== undefined) {
    if (!VERIFICATION_STATUSES.includes(body.verificationStatus)) {
      throw new HttpError(400, 'verificationStatus must be one of: ' + VERIFICATION_STATUSES.join(', ') + '.');
    }
    data.verificationStatus = body.verificationStatus;
  }
  if (body.idDocuments !== undefined) {
    if (!Array.isArray(body.idDocuments)) throw new HttpError(400, 'idDocuments must be an array of strings.');
    data.idDocuments = body.idDocuments.map(item => {
      if (typeof item !== 'string' || item.trim().length > 200) throw new HttpError(400, 'Each idDocuments entry must be a string of at most 200 characters.');
      return item.trim();
    }).filter(item => item);
  }
  if (!Object.keys(data).length) throw new HttpError(400, 'Provide at least one of: verificationStatus, idDocuments.');
  return data;
}
function loginInput(body) {
  object(body);
  if (Object.keys(body).some(key => !['email', 'password', 'adminKey'].includes(key))) throw new HttpError(400, 'Unknown login field.');
  if (typeof body.email !== 'string' || typeof body.password !== 'string') throw new HttpError(400, 'email and password are required.');
  if (body.adminKey !== undefined && typeof body.adminKey !== 'string') throw new HttpError(400, 'adminKey must be a string.');
  if (typeof body.adminKey === 'string' && body.adminKey.length > 200) throw new HttpError(400, 'adminKey must be at most 200 characters.');
  const email = body.email.trim().toLowerCase();
  if (!email || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Invalid email.');
  if (!body.password || body.password.length > 200) throw new HttpError(400, 'Invalid password.');
  return { email, password: body.password, adminKey: body.adminKey === undefined ? '' : body.adminKey };
}
function documentUploadInput(query, contentType) {
  const rawKind = query && typeof query.kind === 'string' ? query.kind.trim().toLowerCase() : '';
  const kind = rawKind || 'other';
  if (!DOCUMENT_KINDS.includes(kind)) throw new HttpError(400, 'kind must be one of: ' + DOCUMENT_KINDS.join(', ') + '.');
  const rawName = query && typeof query.name === 'string' ? query.name.trim() : '';
  if (rawName.length > 200) throw new HttpError(400, 'name must be at most 200 characters.');
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!type) throw new HttpError(415, 'Send the file with a Content-Type header.');
  return { kind, name: rawName, contentType: type };
}
function candidateCreateInput(body) {
  object(body);
  const allowed = ['name', 'role', 'trustScore', 'clearanceTier', 'email', 'verifiedSkills', 'location', 'verificationStatus', 'idDocuments', 'pipeline'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new HttpError(400, 'Unknown candidate field.');
  const text = (key, max) => {
    if (body[key] === undefined) throw new HttpError(400, key + ' is required.');
    if (typeof body[key] !== 'string' || body[key].length > max) throw new HttpError(400, `${key} must be a string of at most ${max} characters.`);
    const value = body[key].trim();
    if (!value) throw new HttpError(400, `${key} cannot be empty.`);
    return value;
  };
  const list = (value, key, max) => {
    if (!Array.isArray(value)) throw new HttpError(400, `${key} must be an array of strings.`);
    return value.map(item => {
      if (typeof item !== 'string' || item.trim().length > max) throw new HttpError(400, `Each ${key} entry must be a string of at most ${max} characters.`);
      return item.trim();
    }).filter(item => item);
  };
  const candidate = { name: text('name', 200), role: text('role', 300), location: text('location', 200) };
  if (body.trustScore === undefined) throw new HttpError(400, 'trustScore is required.');
  if (!Number.isInteger(body.trustScore) || body.trustScore < 0 || body.trustScore > 100) throw new HttpError(400, 'trustScore must be an integer 0–100.');
  candidate.trustScore = body.trustScore;
  if (body.clearanceTier === undefined) throw new HttpError(400, 'clearanceTier is required.');
  if (!Number.isInteger(body.clearanceTier) || body.clearanceTier < 1 || body.clearanceTier > 5) throw new HttpError(400, 'clearanceTier must be an integer 1–5.');
  candidate.clearanceTier = body.clearanceTier;
  if (body.verifiedSkills !== undefined) candidate.verifiedSkills = list(body.verifiedSkills, 'verifiedSkills', 100);
  if (body.idDocuments !== undefined) candidate.idDocuments = list(body.idDocuments, 'idDocuments', 200);
  candidate.verificationStatus = body.verificationStatus === undefined ? 'pending' : body.verificationStatus;
  if (!VERIFICATION_STATUSES.includes(candidate.verificationStatus)) throw new HttpError(400, 'Invalid verificationStatus.');
  candidate.email = emailField(body.email, { required: false });
  let pipeline = null;
  if (body.pipeline !== undefined) {
    object(body.pipeline);
    const raw = body.pipeline;
    if (Object.keys(raw).some(key => !['reqCode', 'currentStep', 'completionPercentage', 'status'].includes(key))) throw new HttpError(400, 'Unknown pipeline field.');
    const code = typeof raw.reqCode === 'string' && raw.reqCode.trim() ? raw.reqCode.trim() : null;
    if (!code || code.length > 100) throw new HttpError(400, 'pipeline reqCode is required and must be at most 100 characters.');
    const currentStep = raw.currentStep === undefined ? 1 : raw.currentStep;
    if (!Number.isInteger(currentStep) || currentStep < 1 || currentStep > 5) throw new HttpError(400, 'pipeline currentStep must be an integer 1–5.');
    const completionPercentage = raw.completionPercentage === undefined ? (currentStep === 5 ? 100 : 0) : raw.completionPercentage;
    if (!Number.isInteger(completionPercentage) || completionPercentage < 0 || completionPercentage > 100) throw new HttpError(400, 'pipeline completionPercentage must be an integer 0–100.');
    const status = raw.status === undefined ? (currentStep === 1 ? 'pending' : 'in_progress') : raw.status;
    if (!['pending', 'in_progress', 'completed', 'on_hold', 'rejected'].includes(status)) throw new HttpError(400, 'Invalid pipeline status.');
    pipeline = { reqCode: code, currentStep, completionPercentage, status };
  }
    return { candidate, pipeline };
}

function teamCreateInput(body) {
  object(body);
  const data = {};
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) {
    throw new HttpError(400, 'name is required and must be at most 120 characters.');
  }
  data.name = body.name.trim();
  data.email = emailField(body.email, { required: true });
  const role = typeof body.role === 'string' ? body.role.trim() : '';
  if (!ROLES.includes(role)) throw new HttpError(400, 'role must be one of: ' + ROLES.join(', ') + '.');
  data.role = role;
  if (role === 'candidate') {
    const rawId = body.candidateId;
    if (rawId === undefined || rawId === null || rawId === '') throw new HttpError(400, 'candidateId is required when role is candidate.');
    const asString = String(rawId);
    if (!/^[0-9a-fA-F]{24}$/.test(asString)) throw new HttpError(400, 'candidateId must be a MongoDB ObjectId.');
    data.candidateId = asString;
  }
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 200) {
    throw new HttpError(400, 'password must be 8-200 characters.');
  }
  data.password = body.password;
  return data;
}

function teamUpdateInput(body) {
  object(body);
  const data = {};
  if (body.role !== undefined) {
    if (typeof body.role !== 'string' || !ROLES.includes(body.role.trim())) {
      throw new HttpError(400, 'role must be one of: ' + ROLES.join(', ') + '.');
    }
    data.role = body.role.trim();
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw new HttpError(400, 'active must be a boolean.');
    data.active = body.active;
  }
  if (!Object.keys(data).length) throw new HttpError(400, 'Provide at least one of: role, active.');
  return data;
}

function auditInput(query) {
  if (!query || typeof query !== 'object') throw new HttpError(400, 'Invalid query.');
  const raw = typeof query.limit === 'string' ? query.limit.trim() : '';
  let limit = 50;
  if (raw) {
    limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, 'limit must be an integer from 1 to 200.');
  }
  const data = { limit };
  if (query.action !== undefined) {
    if (typeof query.action !== 'string' || !query.action.trim()) throw new HttpError(400, 'action must be a non-empty string.');
    data.action = query.action.trim();
  }
  return data;
}

module.exports = {
    HttpError,
  object,
  candidateInput,
  candidateCreateInput,
  emailField,
  analyticsInput,
  notificationsInput,
  feedbackInput,
  checksInput,
  loginInput,
  documentUploadInput,
    candidateCreateInput,
  teamCreateInput,
  teamUpdateInput,
  auditInput,
    ROLES,
  DOCUMENT_KINDS,
  VERIFICATION_STATUSES,
  PIPELINE_STATUSES
};
