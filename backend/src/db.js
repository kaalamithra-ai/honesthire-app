'use strict';
const path = require('node:path');
const fs = require('node:fs');
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const mongoose = require('mongoose');
const { HttpError } = require('./validation');
// Allow model initialization to wait for connect(); API routes reject disconnected requests.
async function connectDatabase(uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/honest_hire') {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  return mongoose.connection;
}
// Shared router guard: never buffer queries while MongoDB is down.
function requireDatabase(req, res, next) {
  if (mongoose.connection.readyState !== 1) return next(new HttpError(503, 'MongoDB is unavailable.'));
  next();
}
module.exports = { mongoose, connectDatabase, requireDatabase };

