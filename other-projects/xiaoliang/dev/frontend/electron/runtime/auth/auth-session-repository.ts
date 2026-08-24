import type { AuthSessionData } from '../../../src/shared/backend-api'
import { getDB } from '../db'

export const BACKEND_AUTH_ACCESS_SECRET_REF = 'backend-auth-access-token'
export const BACKEND_AUTH_REFRESH_SECRET_REF = 'backend-auth-refresh-token'

type AuthSessionRow = {
  token_type: string
  expires_in: number
  access_secret_ref: string
  refresh_secret_ref: string
  user_id: string
  user_email: string
  user_display_name: string | null
  organization_id: string
  organization_name: string
  organization_slug: string
  role: string
}

export type StoredAuthSessionMetadata = {
  tokenType: string
  expiresIn: number
  accessSecretRef: string
  refreshSecretRef: string
  userId: string
  userEmail: string
  userDisplayName: string | null
  organizationId: string
  organizationName: string
  organizationSlug: string
  role: string
}

export function getStoredAuthSessionMetadata(): StoredAuthSessionMetadata | null {
  const db = getDB()
  const row = db.prepare(`
    SELECT
      token_type,
      expires_in,
      access_secret_ref,
      refresh_secret_ref,
      user_id,
      user_email,
      user_display_name,
      organization_id,
      organization_name,
      organization_slug,
      role
    FROM backend_auth_session
    WHERE id = 1
  `).get() as AuthSessionRow | undefined

  if (!row) {
    return null
  }

  return {
    tokenType: row.token_type,
    expiresIn: row.expires_in,
    accessSecretRef: row.access_secret_ref,
    refreshSecretRef: row.refresh_secret_ref,
    userId: row.user_id,
    userEmail: row.user_email,
    userDisplayName: row.user_display_name,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    role: row.role,
  }
}

export function upsertAuthSessionMetadata(
  session: AuthSessionData,
  refs: {
    accessSecretRef?: string
    refreshSecretRef?: string
  } = {},
) {
  const db = getDB()

  db.prepare(`
    INSERT INTO backend_auth_session (
      id,
      token_type,
      expires_in,
      access_secret_ref,
      refresh_secret_ref,
      user_id,
      user_email,
      user_display_name,
      organization_id,
      organization_name,
      organization_slug,
      role
    ) VALUES (
      1, @token_type, @expires_in, @access_secret_ref, @refresh_secret_ref,
      @user_id, @user_email, @user_display_name,
      @organization_id, @organization_name, @organization_slug, @role
    )
    ON CONFLICT(id) DO UPDATE SET
      token_type = excluded.token_type,
      expires_in = excluded.expires_in,
      access_secret_ref = excluded.access_secret_ref,
      refresh_secret_ref = excluded.refresh_secret_ref,
      user_id = excluded.user_id,
      user_email = excluded.user_email,
      user_display_name = excluded.user_display_name,
      organization_id = excluded.organization_id,
      organization_name = excluded.organization_name,
      organization_slug = excluded.organization_slug,
      role = excluded.role,
      updated_at = datetime('now', 'localtime')
  `).run({
    token_type: session.token_type,
    expires_in: session.expires_in,
    access_secret_ref: refs.accessSecretRef || BACKEND_AUTH_ACCESS_SECRET_REF,
    refresh_secret_ref: refs.refreshSecretRef || BACKEND_AUTH_REFRESH_SECRET_REF,
    user_id: session.user.id,
    user_email: session.user.email,
    user_display_name: session.user.display_name,
    organization_id: session.organization.id,
    organization_name: session.organization.name,
    organization_slug: session.organization.slug,
    role: session.role,
  })
}

export function clearAuthSessionMetadata() {
  getDB().prepare('DELETE FROM backend_auth_session WHERE id = 1').run()
}