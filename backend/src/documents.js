'use strict';
const { mongoose } = require('./db');
const { HttpError, DOCUMENT_KINDS } = require('./validation');
// Resumes and ID files live in MongoDB GridFS (bucket: candidateFiles) with metadata mirrored
// on the candidate document, so the roster stays small and the bytes stay out of the JSON feed.
const BUCKET = 'candidateFiles';
const KINDS = DOCUMENT_KINDS;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SIGNATURES = {
  'application/pdf': { label: 'PDF', test: buffer => buffer.length > 4 && buffer.subarray(0, 5).toString('latin1') === '%PDF-' },
  'image/png': { label: 'PNG image', test: buffer => buffer.length > 8 && buffer[0] === 0x89 && buffer.subarray(1, 4).toString('latin1') === 'PNG' },
  'image/jpeg': { label: 'JPEG image', test: buffer => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'application/msword': { label: 'Word document', test: buffer => buffer.length > 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { label: 'Word document', test: buffer => buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04 },
  'text/plain': { label: 'text file', test: () => true }
};
const ALLOWED_TYPES = Object.keys(SIGNATURES);
function allowedTypes() { return ALLOWED_TYPES.join(', '); }
function bucket() { return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET }); }
function collection() { return mongoose.connection.db.collection(BUCKET + '.files'); }
function sanitizeName(value, fallback = 'document') {
  const name = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-').trim().slice(0, 160);
  return name || fallback;
}
const EXTENSIONS = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/plain': 'txt'
};
// Used when the upload does not send ?name=, so every stored file still has a readable name.
function defaultName(kind, contentType) {
  const label = kind === 'id_verification' ? 'id-verification' : kind;
  return label + '-' + Date.now() + '.' + (EXTENSIONS[contentType] || 'bin');
}
function checkContentType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!SIGNATURES[type]) throw new HttpError(415, 'Unsupported file type. Allowed: ' + allowedTypes() + '.');
  return type;
}
function checkSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new HttpError(400, 'Upload a non-empty file body.');
  if (buffer.length > MAX_FILE_BYTES) throw new HttpError(413, 'Files must be ' + Math.round(MAX_FILE_BYTES / (1024 * 1024)) + ' MB or smaller.');
}
async function saveDocument({ candidateId, name, kind, contentType, buffer, uploadedBy }) {
  const type = checkContentType(contentType);
  checkSize(buffer);
  if (!SIGNATURES[type].test(buffer)) throw new HttpError(415, 'File content is not a valid ' + SIGNATURES[type].label + '.');
  const fileName = sanitizeName(name);
  const stream = bucket().openUploadStream(fileName, {
    contentType: type, metadata: { candidateId: String(candidateId), kind, uploadedBy }
  });
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.once('finish', resolve);
    stream.end(buffer);
  });
  return {
    fileId: String(stream.id), name: fileName, kind, contentType: type,
    size: buffer.length, uploadedBy, uploadedAt: new Date()
  };
}
async function findDocument(fileId) {
  if (!mongoose.isObjectIdOrHexString(fileId)) throw new HttpError(400, 'fileId must be a MongoDB ObjectId.');
  return collection().findOne({ _id: new mongoose.Types.ObjectId(fileId) });
}
async function openDownloadStream(fileId) {
  const file = await findDocument(fileId);
  if (!file) throw new HttpError(404, 'Document not found.');
  return { file, stream: bucket().openDownloadStream(file._id) };
}
async function removeDocument(fileId) {
  const file = await findDocument(fileId);
  if (!file) return false;
  await bucket().delete(file._id);
  return true;
}
module.exports = {
  BUCKET, KINDS, MAX_FILE_BYTES, ALLOWED_TYPES,
  allowedTypes, sanitizeName, defaultName, checkContentType, saveDocument, findDocument, openDownloadStream, removeDocument
};
