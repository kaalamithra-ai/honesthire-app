'use strict';
// Single source of truth for the API base URL.
//
// The frontend is plain static HTML with no build step, so process.env cannot be read in the
// browser. This server-side constant reads the environment once, and the resolved value is
// injected into the page by GET /config.js (see app.js), where resolveApiBase() picks it up.
// NEXT_PUBLIC_/REACT_APP_ names are accepted so the same variables work if the frontend is ever
// moved onto a bundler.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || process.env.REACT_APP_API_URL || 'http://127.0.0.1:5000';

// Strip a trailing slash so callers can safely join '/api/...'.
const apiBaseUrl = String(API_BASE_URL).replace(/\/+$/, '');

module.exports = { API_BASE_URL, apiBaseUrl };