import { fromBufferPromise, type ZipFile } from 'yauzl'

const OOXML_MAX_ENTRIES = 10_000
const OOXML_MAX_ENTRY_BYTES = 32 * 1024 * 1024
const OOXML_MAX_EXPANDED_BYTES = 64 * 1024 * 1024
const OOXML_MAX_COMPRESSION_RATIO = 100

export async function validateProjectOoxmlPreview(
  archive: Buffer,
  kind: 'docx' | 'xlsx',
) {
  let zipFile: ZipFile
  try {
    zipFile = await fromBufferPromise(archive, {
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    })
  } catch {
    throw new Error('Office 文件不是有效的 OOXML 压缩包。')
  }
  if (zipFile.entryCount > OOXML_MAX_ENTRIES) {
    zipFile.close()
    throw new Error('Office 文件包含过多压缩条目。')
  }

  const requiredEntry = kind === 'docx' ? 'word/document.xml' : 'xl/workbook.xml'
  try {
    await scanArchive(zipFile, requiredEntry)
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error('Office 文件压缩结构损坏。')
  } finally {
    zipFile.close()
  }
}

async function scanArchive(zipFile: ZipFile, requiredEntry: string) {
  let expandedBytes = 0
  let hasContentTypes = false
  let hasRequiredEntry = false
  const names = new Set<string>()

  for await (const entry of zipFile.eachEntry()) {
    if (names.has(entry.fileName)) throw new Error('Office 文件包含重复压缩条目。')
    names.add(entry.fileName)
    if (entry.isEncrypted() || !entry.canDecodeFileData()) {
      throw new Error('加密或编码不受支持的 Office 文件无法预览。')
    }
    if (
      !Number.isSafeInteger(entry.uncompressedSize)
      || !Number.isSafeInteger(entry.compressedSize)
      || entry.uncompressedSize < 0
      || entry.compressedSize < 0
      || entry.uncompressedSize > OOXML_MAX_ENTRY_BYTES
    ) {
      throw new Error('Office 文件的单个压缩条目超过安全限制。')
    }
    if (
      entry.uncompressedSize > 0
      && (entry.compressedSize === 0
        || entry.uncompressedSize / entry.compressedSize > OOXML_MAX_COMPRESSION_RATIO)
    ) {
      throw new Error('Office 文件压缩比超过安全限制。')
    }
    if (entry.fileName === '[Content_Types].xml') hasContentTypes = true
    if (entry.fileName === requiredEntry) hasRequiredEntry = true

    let entryExpandedBytes = 0
    const stream = await zipFile.openReadStreamPromise(entry)
    for await (const chunk of stream as AsyncIterable<unknown>) {
      if (!(chunk instanceof Uint8Array)) throw new Error('Office 文件产生了无效数据流。')
      entryExpandedBytes += chunk.byteLength
      expandedBytes += chunk.byteLength
      if (
        !Number.isSafeInteger(entryExpandedBytes)
        || entryExpandedBytes > OOXML_MAX_ENTRY_BYTES
        || !Number.isSafeInteger(expandedBytes)
        || expandedBytes > OOXML_MAX_EXPANDED_BYTES
      ) {
        throw new Error('Office 文件解压后超过安全限制。')
      }
      if (
        entryExpandedBytes > 0
        && (entry.compressedSize === 0
          || entryExpandedBytes / entry.compressedSize > OOXML_MAX_COMPRESSION_RATIO)
      ) {
        throw new Error('Office 文件压缩比超过安全限制。')
      }
    }
    if (entryExpandedBytes !== entry.uncompressedSize) {
      throw new Error('Office 文件条目大小与元数据不一致。')
    }
  }
  if (!hasContentTypes || !hasRequiredEntry) {
    throw new Error('Office 文件缺少必要的 OOXML 文档结构。')
  }
}
