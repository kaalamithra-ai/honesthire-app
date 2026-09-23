'use strict';
const AuditLog = require('./models/AuditLog');
const { actorFromRequest, ANONYMOUS_ACTOR } = require('./auth');
// Fire-and-forget audit writer: failures are logged but never thrown, so auditing can
// never break the request that caused it. `req.user` (already a publicUser) is preferred;
// otherwise we resolve the actor from the bearer token, or mark it anonymously signed-out.
async function writeAudit(req, action, target = {}, details = {}, actorOverride) {
  let actor = actorOverride;
  if (!actor) {
    if (req && req.user) {
      actor = req.user;
    } else {
      try { actor = await actorFromRequest(req); } catch { actor = ANONYMOUS_ACTOR; }
    }
  }
  try {
    await AuditLog.MODEL.create({
      actor: {
        id: String(actor && actor.id ? actor.id : ''),
        name: String(actor && actor.name ? actor.name : 'Signed-out operator'),
        email: String(actor && actor.email ? actor.email : ''),
        role: String(actor && actor.role ? actor.role : '')
      },
      action,
      target: {
        kind: String(target.kind || ''),
        id: String(target.id || ''),
        label: String(target.label || '')
      },
      details: details || {},
      ip: req ? String(req.get('x-forwarded-for') || req.socket && req.socket.remoteAddress || '') : '',
      userAgent: req ? String(req.get('user-agent') || '') : ''
    });
  } catch (error) {
    console.error('Audit log failed:', error.message);
  }
}
module.exports = { writeAudit };
