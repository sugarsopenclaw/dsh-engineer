export const TRUSTED_SKILL_PACK_PUBLIC_KEY_BASE64 = (
  process.env.XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64 || ''
).trim()

export const TRUSTED_SKILL_PACK_SIGNING_KEY_ID = (
  process.env.XIAOLIANG_SKILL_PACK_SIGNING_KEY_ID || 'primary-v1'
).trim()
