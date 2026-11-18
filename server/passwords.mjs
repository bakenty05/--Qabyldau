import { audit, digest, token, transaction, passwordHash } from './store.mjs'

export const RESET_LIFETIME = 30 * 60 * 1000
export function issuePasswordReset(db, userId, actorId = null) {
  const user = db.prepare("SELECT id FROM users WHERE id=? AND status='active'").get(userId)
  if (!user) throw new Error('Белсенді аккаунт табылмады.')
  const secret = token(), now = Date.now(), expiresAt = now + RESET_LIFETIME
  transaction(db, () => {
    db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires_at<=?').run(userId, now)
    db.prepare('INSERT INTO password_resets VALUES (?,?,?,?)').run(digest(secret), userId, expiresAt, now)
    db.prepare('DELETE FROM recovery_requests WHERE user_id=?').run(userId)
    audit(db, actorId, 'password.reset-issued', userId)
  })
  return { token: secret, expiresAt }
}

export function replacePassword(db, userId, password, action, actorId = userId) {
  const hash = passwordHash(password)
  transaction(db, () => {
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, userId)
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId)
    db.prepare('DELETE FROM password_resets WHERE user_id=?').run(userId)
    db.prepare('DELETE FROM recovery_requests WHERE user_id=?').run(userId)
    audit(db, actorId, action, userId)
  })
}
