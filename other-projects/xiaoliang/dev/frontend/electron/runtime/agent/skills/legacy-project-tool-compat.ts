const LEGACY_PROJECT_TOOL_PATTERN = /\b(?:project_files_list|project_files_search|project_file_read|project_artifacts_list|project_artifact_write_text|project_quantity_excel_write|project_docx_write|project_pptx_write|project_list|project_search|project_read)\b/

const COMPATIBILITY_NOTE = [
  '> [晓量兼容说明] 这份 Skill 使用了旧项目工具名，以下内容已在内存中转换为当前工具接口；磁盘原文件未修改。',
  '> 文件浏览/检索现在使用通用工具：ls 列目录、find 按 glob 找文件、grep 搜文本内容、read 读取纯文本与图片。',
  '> PDF/Word/PPT/Excel 富文档解析使用 doc_parse；旧文本、Excel、Word、PPT 写入分别使用 `project_artifact_create` 的对应 format。',
].join('\n')

function insertCompatibilityNote(content: string) {
  const frontmatter = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/)
  if (!frontmatter) return `${COMPATIBILITY_NOTE}\n\n${content}`
  return `${frontmatter[1]}${COMPATIBILITY_NOTE}\n\n${content.slice(frontmatter[1].length)}`
}

function migrateTextArtifactCalls(content: string) {
  return content.replace(
    /\bproject_artifact_write_text\s*\(\s*\{([\s\S]*?)\}\s*\)/g,
    (_match, rawBody: string) => {
      const body = /\bkind\s*:/.test(rawBody)
        ? rawBody.replace(/\bkind\s*:/, 'format:')
        : ` format: "text",${rawBody}`
      return `project_artifact_create({${body}})`
    },
  )
}

/**
 * Keeps installed/user-authored Skill files immutable while translating retired
 * project tool names before their instructions enter the model context.
 * project_list/project_search/project_read 已由 Pi 通用工具(ls/find/grep/read)
 * 与 doc_parse(富文档解析)接替。
 */
export function migrateLegacyProjectToolReferences(content: string) {
  if (!LEGACY_PROJECT_TOOL_PATTERN.test(content)) return content

  let migrated = migrateTextArtifactCalls(content)
  migrated = migrated
    .replace(/\bproject_artifacts_list\s*\(\s*\)/g, 'ls({ path: "xiaoliang-outputs" })')
    .replace(/\bproject_artifacts_list\s*\(\s*\{/g, 'ls({ path: "xiaoliang-outputs",')
    .replace(/\bproject_quantity_excel_write\s*\(\s*\{/g, 'project_artifact_create({ format: "xlsx",')
    .replace(/\bproject_docx_write\s*\(\s*\{/g, 'project_artifact_create({ format: "docx",')
    .replace(/\bproject_pptx_write\s*\(\s*\{/g, 'project_artifact_create({ format: "pptx",')
    .replace(/\bproject_files_list\b/g, 'ls')
    .replace(/\bproject_files_search\b/g, 'grep')
    .replace(/\bproject_file_read\b/g, 'doc_parse')
    .replace(/\bproject_artifacts_list\b/g, 'ls')
    .replace(/\bproject_artifact_write_text\b/g, 'project_artifact_create')
    .replace(/\bproject_quantity_excel_write\b/g, 'project_artifact_create')
    .replace(/\bproject_docx_write\b/g, 'project_artifact_create')
    .replace(/\bproject_pptx_write\b/g, 'project_artifact_create')
    .replace(/\bproject_list\b/g, 'ls')
    .replace(/\bproject_search\b/g, 'grep')
    .replace(/\bproject_read\b/g, 'doc_parse')

  return insertCompatibilityNote(migrated)
}
