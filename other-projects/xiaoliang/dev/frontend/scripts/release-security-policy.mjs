import crypto from 'node:crypto'

const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export const INTERNAL_PACK_ENV = 'XIAOLIANG_INTERNAL_PACK'
export const LEGACY_UNSIGNED_RELEASE_ENV = 'XIAOLIANG_LEGACY_UNSIGNED_RELEASE'

export function isInternalPack(environment = process.env) {
  return environment[INTERNAL_PACK_ENV]?.trim() === '1'
}

export function isLegacyUnsignedRelease(environment = process.env) {
  return environment[LEGACY_UNSIGNED_RELEASE_ENV]?.trim() === '1'
}

export function validateSkillPackTrustAnchor(publicKeyBase64, keyId = 'primary-v1') {
  const normalizedPublicKey = String(publicKeyBase64 || '').trim()
  const normalizedKeyId = String(keyId || '').trim()
  if (!normalizedPublicKey) {
    throw new Error('XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64 is required')
  }
  if (
    !CANONICAL_BASE64_PATTERN.test(normalizedPublicKey)
    || Buffer.from(normalizedPublicKey, 'base64').toString('base64') !== normalizedPublicKey
  ) {
    throw new Error('XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64 must be canonical Base64')
  }
  if (!KEY_ID_PATTERN.test(normalizedKeyId)) {
    throw new Error('XIAOLIANG_SKILL_PACK_SIGNING_KEY_ID is invalid')
  }

  let publicKey
  try {
    publicKey = crypto.createPublicKey({
      key: Buffer.from(normalizedPublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    })
  } catch (error) {
    throw new Error(
      'XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64 must contain an SPKI DER public key',
      { cause: error },
    )
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64 must contain an Ed25519 public key')
  }

  return {
    publicKeyBase64: normalizedPublicKey,
    keyId: normalizedKeyId,
  }
}

export function hasConfiguredPublisherName(yaml) {
  const isNonEmptyScalar = (value) => {
    const normalized = value.trim()
    return Boolean(
      normalized
      && !normalized.startsWith('#')
      && !['[]', '{}', 'null', '~', "''", '""'].includes(normalized),
    )
  }
  const lines = String(yaml || '').split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^publisherName:\s*(.*?)\s*$/u)
    if (!match) continue

    if (isNonEmptyScalar(match[1])) return true
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child]
      if (!line.trim()) continue
      if (!/^\s/u.test(line)) break
      const listItem = line.match(/^\s+-\s+(.*)$/u)
      if (listItem && isNonEmptyScalar(listItem[1])) return true
    }
    return false
  }
  return false
}
