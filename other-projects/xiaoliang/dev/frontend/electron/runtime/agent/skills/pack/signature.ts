import crypto from 'node:crypto'
import type { SkillPackPayload } from './types'

const SIGNATURE_CONTEXT = Buffer.from('xiaoliang-skill-pack-checksum-v1\0', 'utf8')
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export function buildSkillPackSignatureMessage(checksum: string) {
  const normalized = checksum.trim().toLowerCase()
  if (!CHECKSUM_PATTERN.test(normalized)) {
    throw new Error('skill 包 checksum 不是 canonical SHA-256。')
  }
  return Buffer.concat([SIGNATURE_CONTEXT, Buffer.from(normalized, 'ascii')])
}

export function verifySkillPackSignature(
  pack: SkillPackPayload,
  publicKeyBase64: string,
  trustedKeyId: string,
) {
  const signature = pack.signature
  if (!signature) throw new Error('skill 包缺少 Ed25519 签名。')
  if (signature.algorithm !== 'Ed25519') {
    throw new Error(`不支持的 skill 包签名算法：${String(signature.algorithm)}`)
  }
  if (!KEY_ID_PATTERN.test(signature.key_id) || signature.key_id !== trustedKeyId) {
    throw new Error(`skill 包签名 key id 不受信任：${signature.key_id}`)
  }
  const normalizedPublicKey = publicKeyBase64.trim()
  if (!normalizedPublicKey) {
    throw new Error('客户端未内嵌 skill 包签名公钥，已拒绝安装。')
  }

  const publicKey = decodeBase64(normalizedPublicKey, '签名公钥')
  const signatureBytes = decodeBase64(signature.value, '签名值')
  if (signatureBytes.length !== 64) throw new Error('skill 包 Ed25519 签名长度非法。')
  try {
    const key = crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' })
    if (!crypto.verify(
      null,
      buildSkillPackSignatureMessage(pack.skill_pack_checksum),
      key,
      signatureBytes,
    )) {
      throw new Error('skill 包 Ed25519 签名校验失败。')
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('skill 包')) throw error
    throw new Error('skill 包签名公钥格式错误。', { cause: error })
  }
}

function decodeBase64(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized || !BASE64_PATTERN.test(normalized)) {
    throw new Error(`skill 包${label}不是合法 Base64。`)
  }
  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.toString('base64') !== normalized) {
    throw new Error(`skill 包${label}不是 canonical Base64。`)
  }
  return decoded
}
