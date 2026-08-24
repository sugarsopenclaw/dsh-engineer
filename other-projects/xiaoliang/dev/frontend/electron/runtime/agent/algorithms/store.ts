import { app } from 'electron'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { LocalAlgorithmSummary } from '../../../../src/shared/local-agent'
import { getConversationSummary } from '../../conversations/conversation-repository'

const ALGORITHM_MANIFEST_VERSION = 1
const ALGORITHM_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,80}$/i
const PYTHON_TIMEOUT_MS = 20_000
const MAX_OUTPUT_CHARS = 64_000
const RESULT_MARKER = '__XIAOLIANG_ALGORITHM_RESULT__'
const FRUSTUM_ALGORITHM_PATTERN =
  /截头体|棱台|截锥|锥形独立基础|D[_\s-]?Jp|DJP|DJ\b|DU\b|h1\s*(?:\/|和|与|,|，)\s*h2|300\s*\/\s*600|300\s*\/\s*700/i

type AlgorithmStatus = 'draft' | 'saved'

interface AlgorithmManifestRecord {
  slug: string
  domain: 'cad'
  status: AlgorithmStatus
  component_type: string
  subtype_code?: string
  drawing_name?: string
  component_label?: string
  version: string
  source_conversation_id: string
  created_at: string
  updated_at: string
  confirmed_at?: string
  confirmation_summary?: string
  parameter_fields: string[]
  calculator_checksum: string
  path: string
  last_run?: AlgorithmRunSnapshot
}

interface AlgorithmManifest {
  version: number
  updated_at: string
  algorithms: AlgorithmManifestRecord[]
}

interface AlgorithmRunSnapshot {
  status: 'success' | 'failed'
  ran_at: string
  elapsed_ms: number
  error?: string
  result?: unknown
}

interface AlgorithmMetadata {
  version: number
  slug: string
  domain: 'cad'
  status: AlgorithmStatus
  component_type: string
  subtype_code?: string
  drawing_name?: string
  component_label?: string
  algorithm_version: string
  source_conversation_id: string
  created_at: string
  updated_at: string
  confirmed_at?: string
  confirmation_summary?: string
  calculator_checksum: string
  parameter_contract: unknown
  validation_cases: unknown
  parameter_fields: string[]
  safety_warnings: string[]
  last_run?: AlgorithmRunSnapshot
}

export interface WriteCadAlgorithmDraftInput {
  algorithmSlug: string
  calculatorCode: string
  parameterContract: unknown
  validationCases: unknown
  sourceConversationId: string
}

export interface WriteCadAlgorithmDraftResult {
  slug: string
  algorithmDir: string
  calculatorPath: string
  parameterContractPath: string
  validationCasesPath: string
  metadataPath: string
  calculatorChecksum: string
  safetyWarnings: string[]
  parameterFields: string[]
}

export interface RunCadAlgorithmInput {
  algorithmSlug: string
  inputData: unknown
  sourcePreference?: 'auto' | 'draft' | 'saved'
}

export interface RunCadAlgorithmResult {
  slug: string
  status: 'success' | 'failed'
  source: 'draft' | 'saved'
  elapsedMs: number
  result: unknown | null
  stdout: string
  stderr: string
  error: string | null
  algorithmDir: string
}

export interface SaveCadAlgorithmInput {
  algorithmSlug: string
  confirmationSummary: string
  subtypeCode?: string | null
  drawingName?: string | null
  componentLabel?: string | null
}

export interface SaveCadAlgorithmResult {
  slug: string
  algorithmDir: string
  calculatorPath: string
  metadataPath: string
  summary: LocalAlgorithmSummary
}

export interface CadAlgorithmDetail extends LocalAlgorithmSummary {
  algorithmDir: string
  calculatorPath: string
  metadataPath: string
  parameterContract: unknown
  validationCases: unknown
  confirmationSummary: string | null
  lastRun: AlgorithmRunSnapshot | null
}

export interface CadAlgorithmExportBundle {
  slug: string
  source: 'draft' | 'saved'
  algorithmDir: string
  files: Array<{
    name: string
    path: string
  }>
}

export function listLocalAlgorithms(): LocalAlgorithmSummary[] {
  const manifest = readAlgorithmManifest()
  return manifest.algorithms
    .filter((algorithm) => algorithm.status === 'saved')
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .map((algorithm) => ({
      slug: algorithm.slug,
      domain: algorithm.domain,
      componentType: algorithm.component_type,
      subtypeCode: algorithm.subtype_code ?? null,
      drawingName: algorithm.drawing_name ?? null,
      componentLabel: algorithm.component_label ?? null,
      version: algorithm.version,
      status: 'saved',
      path: algorithm.path,
      parameterFields: algorithm.parameter_fields,
      sourceConversationId: algorithm.source_conversation_id,
      createdAt: algorithm.created_at,
      updatedAt: algorithm.updated_at,
      confirmedAt: algorithm.confirmed_at ?? null,
      calculatorChecksum: algorithm.calculator_checksum,
    }))
}

export function readCadAlgorithmDetail(slugInput: string): CadAlgorithmDetail | null {
  const slug = normalizeSlug(slugInput)
  const algorithmDir = path.join(getSavedCadAlgorithmsRoot(), slug)
  const calculatorPath = path.join(algorithmDir, 'calculator.py')
  const metadataPath = path.join(algorithmDir, 'metadata.json')
  if (!fs.existsSync(calculatorPath) || !fs.existsSync(metadataPath)) return null
  const metadata = readAlgorithmMetadata(metadataPath)
  if (!metadata || metadata.status !== 'saved') return null
  return {
    slug,
    domain: 'cad',
    componentType: metadata.component_type,
    subtypeCode: metadata.subtype_code ?? null,
    drawingName: metadata.drawing_name ?? null,
    componentLabel: metadata.component_label ?? null,
    version: metadata.algorithm_version,
    status: 'saved',
    path: path.posix.join('cad', slug, 'calculator.py'),
    parameterFields: metadata.parameter_fields,
    sourceConversationId: metadata.source_conversation_id,
    createdAt: metadata.created_at,
    updatedAt: metadata.updated_at,
    confirmedAt: metadata.confirmed_at ?? null,
    calculatorChecksum: metadata.calculator_checksum,
    algorithmDir,
    calculatorPath,
    metadataPath,
    parameterContract: metadata.parameter_contract,
    validationCases: metadata.validation_cases,
    confirmationSummary: metadata.confirmation_summary ?? null,
    lastRun: metadata.last_run ?? null,
  }
}

export function readCadAlgorithmExportBundle(input: {
  algorithmSlug: string
  source?: 'draft' | 'saved'
}): CadAlgorithmExportBundle {
  const slug = normalizeSlug(input.algorithmSlug)
  const source = input.source ?? 'saved'
  const root = source === 'draft' ? getDraftCadAlgorithmsRoot() : getSavedCadAlgorithmsRoot()
  const algorithmDir = path.join(root, slug)
  assertInside(root, algorithmDir)

  const fileNames = ['calculator.py', 'parameter_contract.json', 'validation_cases.json', 'metadata.json']
  const files = fileNames.map((fileName) => {
    const filePath = path.join(algorithmDir, fileName)
    if (!fs.existsSync(filePath)) {
      throw new Error(`未找到${source === 'draft' ? '草稿' : '已保存'}算法文件：${slug}/${fileName}`)
    }
    return {
      name: fileName,
      path: filePath,
    }
  })

  return {
    slug,
    source,
    algorithmDir,
    files,
  }
}

export function findLocalAlgorithms(input: {
  query?: string
  slug?: string
  limit?: number
} = {}): CadAlgorithmDetail[] {
  const limit = Math.max(1, Math.min(input.limit ?? 5, 10))
  const rawSlug = input.slug?.trim().toLowerCase()
  if (rawSlug) {
    const exact = readCadAlgorithmDetail(rawSlug)
    return exact ? [exact] : []
  }

  const query = input.query?.trim() ?? ''
  const algorithms = listLocalAlgorithms()
    .flatMap((algorithm) => readCadAlgorithmDetail(algorithm.slug) ?? [])
  if (!query) {
    return algorithms.slice(0, limit)
  }

  const normalizedQuery = query.toLowerCase()
  const scored = algorithms.flatMap((algorithm) => {
    let score = 0
    if (algorithm.slug === normalizedQuery) score += 30
    if (normalizedQuery.includes(algorithm.slug.toLowerCase())) score += 12
    if (algorithm.slug === 'frustum-box-foundation' && FRUSTUM_ALGORITHM_PATTERN.test(query)) {
      score += 24
    }
    if (algorithm.componentType && normalizedQuery.includes(algorithm.componentType.toLowerCase())) {
      score += 8
    }
    if (algorithm.subtypeCode && normalizedQuery.includes(algorithm.subtypeCode.toLowerCase())) {
      score += 12
    }
    if (algorithm.componentLabel && normalizedQuery.includes(algorithm.componentLabel.toLowerCase())) {
      score += 10
    }
    if (algorithm.drawingName && normalizedQuery.includes(algorithm.drawingName.toLowerCase())) {
      score += 3
    }
    if (
      algorithm.confirmationSummary
      && textLooksRelated(normalizedQuery, algorithm.confirmationSummary.toLowerCase())
    ) {
      score += 6
    }
    for (const field of algorithm.parameterFields) {
      if (field && normalizedQuery.includes(field.toLowerCase())) score += 2
    }
    return score > 0 ? [{ algorithm, score }] : []
  })
  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.algorithm)
}

function textLooksRelated(query: string, target: string) {
  const tokens = query
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 2)
    .slice(0, 32)
  return tokens.some((token) => target.includes(token))
}

export function buildAvailableAlgorithmsContext(input: {
  query: string
  hasImages: boolean
}): string {
  if (!input.query.trim()) {
    return ''
  }
  const matched = findLocalAlgorithms({
    query: input.query,
    limit: input.hasImages ? 5 : 3,
  })
  if (matched.length === 0) {
    return ''
  }
  const lines = [
    '[algorithm_assets]',
    '本地已确认算法资产如下。若当前构件匹配其中算法，且用户没有明确要求重写/优化算法，禁止重复生成 calculator.py；应先提取参数并调用 cad_algorithm_run 复用既有算法。',
    '<available_algorithms>',
  ]
  for (const algorithm of matched) {
    lines.push('  <algorithm>')
    lines.push(`    <slug>${escapeXml(algorithm.slug)}</slug>`)
    lines.push(`    <component_type>${escapeXml(algorithm.componentType)}</component_type>`)
    lines.push(`    <version>${escapeXml(algorithm.version)}</version>`)
    lines.push(`    <confirmed_at>${escapeXml(algorithm.confirmedAt || '')}</confirmed_at>`)
    lines.push(`    <parameter_fields>${escapeXml(algorithm.parameterFields.join(', '))}</parameter_fields>`)
    lines.push('  </algorithm>')
  }
  lines.push('</available_algorithms>')
  return lines.join('\n')
}

export function writeCadAlgorithmDraft(input: WriteCadAlgorithmDraftInput): WriteCadAlgorithmDraftResult {
  const slug = normalizeSlug(input.algorithmSlug)
  validateCalculatorCode(input.calculatorCode)
  if (!input.sourceConversationId.trim()) {
    throw new Error('source_conversation_id 不能为空。')
  }

  const parameterContract = normalizeJsonLike(input.parameterContract)
  const validationCases = normalizeJsonLike(input.validationCases)
  const now = new Date().toISOString()
  const algorithmDir = path.join(getDraftCadAlgorithmsRoot(), slug)
  assertInside(getDraftCadAlgorithmsRoot(), algorithmDir)
  const calculatorPath = path.join(algorithmDir, 'calculator.py')
  const parameterContractPath = path.join(algorithmDir, 'parameter_contract.json')
  const validationCasesPath = path.join(algorithmDir, 'validation_cases.json')
  const metadataPath = path.join(algorithmDir, 'metadata.json')
  const calculatorChecksum = sha256Text(input.calculatorCode)
  const parameterFields = extractParameterFields(parameterContract)
  const componentType = extractComponentType(parameterContract) || slug
  const safetyWarnings = detectHardcodedNumericRisk(input.calculatorCode)

  const existingMetadata = readAlgorithmMetadata(metadataPath)
  const metadata: AlgorithmMetadata = {
    version: ALGORITHM_MANIFEST_VERSION,
    slug,
    domain: 'cad',
    status: 'draft',
    component_type: componentType,
    subtype_code: existingMetadata?.subtype_code,
    drawing_name: existingMetadata?.drawing_name,
    component_label: existingMetadata?.component_label,
    algorithm_version: existingMetadata?.algorithm_version ?? 'local-draft-1',
    source_conversation_id: input.sourceConversationId.trim(),
    created_at: existingMetadata?.created_at ?? now,
    updated_at: now,
    calculator_checksum: calculatorChecksum,
    parameter_contract: parameterContract,
    validation_cases: validationCases,
    parameter_fields: parameterFields,
    safety_warnings: safetyWarnings,
    last_run: existingMetadata?.last_run,
  }

  fs.mkdirSync(algorithmDir, { recursive: true })
  fs.writeFileSync(calculatorPath, input.calculatorCode.trimEnd() + '\n', 'utf-8')
  fs.writeFileSync(parameterContractPath, `${JSON.stringify(parameterContract, null, 2)}\n`, 'utf-8')
  fs.writeFileSync(validationCasesPath, `${JSON.stringify(validationCases, null, 2)}\n`, 'utf-8')
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8')

  return {
    slug,
    algorithmDir,
    calculatorPath,
    parameterContractPath,
    validationCasesPath,
    metadataPath,
    calculatorChecksum,
    safetyWarnings,
    parameterFields,
  }
}

export async function runCadAlgorithm(input: RunCadAlgorithmInput): Promise<RunCadAlgorithmResult> {
  const slug = normalizeSlug(input.algorithmSlug)
  const resolved = resolveAlgorithmForRun(slug, input.sourcePreference ?? 'auto')
  const startedAt = Date.now()
  const execution = await executePythonCalculator(resolved.calculatorPath, input.inputData)
  const elapsedMs = Date.now() - startedAt
  const normalizedResult = normalizeCalculatorOutput(execution.result, input.inputData)
  const validation = validateCalculatorOutput(normalizedResult)
  const error = execution.error || validation
  const status: 'success' | 'failed' = error ? 'failed' : 'success'
  const snapshot: AlgorithmRunSnapshot = {
    status,
    ran_at: new Date().toISOString(),
    elapsed_ms: elapsedMs,
    ...(error ? { error } : {}),
    ...(status === 'success' ? { result: normalizedResult } : {}),
  }
  updateAlgorithmRunSnapshot(resolved.metadataPath, snapshot)

  return {
    slug,
    status,
    source: resolved.source,
    elapsedMs,
    result: status === 'success' ? normalizedResult : null,
    stdout: execution.stdout,
    stderr: execution.stderr,
    error: error || null,
    algorithmDir: resolved.algorithmDir,
  }
}

export function saveCadAlgorithm(input: SaveCadAlgorithmInput): SaveCadAlgorithmResult {
  const slug = normalizeSlug(input.algorithmSlug)
  const confirmationSummary = input.confirmationSummary.trim()
  if (!confirmationSummary) {
    throw new Error('confirmation_summary 不能为空。')
  }

  const draftDir = path.join(getDraftCadAlgorithmsRoot(), slug)
  const draftMetadataPath = path.join(draftDir, 'metadata.json')
  const draftMetadata = readAlgorithmMetadata(draftMetadataPath)
  if (!draftMetadata) {
    throw new Error(`未找到算法草稿：${slug}`)
  }
  if (draftMetadata.last_run?.status !== 'success') {
    throw new Error('最近一次算法执行未成功，不能保存为算法资产。')
  }

  const now = new Date().toISOString()
  const conversationSummary = getConversationSummary(draftMetadata.source_conversation_id)
  const drawingName = normalizeOptionalText(input.drawingName)
    ?? normalizeOptionalText(conversationSummary?.drawingName)
    ?? draftMetadata.drawing_name
  const componentLabel = normalizeOptionalText(input.componentLabel)
    ?? draftMetadata.component_label
    ?? draftMetadata.component_type
  const subtypeCode = normalizeOptionalText(input.subtypeCode)
    ?? draftMetadata.subtype_code
  const targetRoot = getSavedCadAlgorithmsRoot()
  const targetDir = path.join(targetRoot, slug)
  assertInside(targetRoot, targetDir)
  const tmpDir = path.join(targetRoot, `.tmp-${slug}-${Date.now()}`)
  const backupDir = path.join(targetRoot, `.backup-${slug}-${Date.now()}`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })

  copyAlgorithmFiles(draftDir, tmpDir)
  const metadata: AlgorithmMetadata = {
    ...draftMetadata,
    status: 'saved',
    subtype_code: subtypeCode,
    drawing_name: drawingName,
    component_label: componentLabel,
    algorithm_version: draftMetadata.algorithm_version.replace('draft', 'verified'),
    updated_at: now,
    confirmed_at: now,
    confirmation_summary: confirmationSummary,
  }
  fs.writeFileSync(path.join(tmpDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8')

  fs.mkdirSync(targetRoot, { recursive: true })
  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir)
    }
    fs.renameSync(tmpDir, targetDir)
    fs.rmSync(backupDir, { recursive: true, force: true })
  } catch (error) {
    fs.rmSync(targetDir, { recursive: true, force: true })
    if (fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, targetDir)
    }
    fs.rmSync(tmpDir, { recursive: true, force: true })
    throw error
  }

  upsertAlgorithmManifestRecord({
    slug,
    domain: 'cad',
    status: 'saved',
    component_type: metadata.component_type,
    subtype_code: metadata.subtype_code,
    drawing_name: metadata.drawing_name,
    component_label: metadata.component_label,
    version: metadata.algorithm_version,
    source_conversation_id: metadata.source_conversation_id,
    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
    confirmed_at: metadata.confirmed_at,
    confirmation_summary: metadata.confirmation_summary,
    parameter_fields: metadata.parameter_fields,
    calculator_checksum: metadata.calculator_checksum,
    path: path.posix.join('cad', slug, 'calculator.py'),
    last_run: metadata.last_run,
  })

  const summary: LocalAlgorithmSummary = {
    slug,
    domain: 'cad',
    componentType: metadata.component_type,
    subtypeCode: metadata.subtype_code ?? null,
    drawingName: metadata.drawing_name ?? null,
    componentLabel: metadata.component_label ?? null,
    version: metadata.algorithm_version,
    status: 'saved',
    path: path.posix.join('cad', slug, 'calculator.py'),
    parameterFields: metadata.parameter_fields,
    sourceConversationId: metadata.source_conversation_id,
    createdAt: metadata.created_at,
    updatedAt: metadata.updated_at,
    confirmedAt: metadata.confirmed_at ?? null,
    calculatorChecksum: metadata.calculator_checksum,
  }

  return {
    slug,
    algorithmDir: targetDir,
    calculatorPath: path.join(targetDir, 'calculator.py'),
    metadataPath: path.join(targetDir, 'metadata.json'),
    summary,
  }
}

function resolveAlgorithmForRun(
  slug: string,
  sourcePreference: 'auto' | 'draft' | 'saved' = 'auto',
) {
  const draftDir = path.join(getDraftCadAlgorithmsRoot(), slug)
  const savedDir = path.join(getSavedCadAlgorithmsRoot(), slug)
  const draftExists = fs.existsSync(path.join(draftDir, 'calculator.py'))
  const savedExists = fs.existsSync(path.join(savedDir, 'calculator.py'))
  const source =
    sourcePreference === 'draft'
      ? 'draft' as const
      : sourcePreference === 'saved'
      ? 'saved' as const
      : draftExists
      ? 'draft' as const
      : 'saved' as const
  const algorithmDir = source === 'draft' ? draftDir : savedDir
  const calculatorPath = path.join(algorithmDir, 'calculator.py')
  const metadataPath = path.join(algorithmDir, 'metadata.json')
  const exists = source === 'draft' ? draftExists : savedExists
  if (!exists) {
    throw new Error(`未找到${source === 'draft' ? '草稿' : '已保存'}算法文件：${slug}/calculator.py`)
  }
  assertInside(source === 'draft' ? getDraftCadAlgorithmsRoot() : getSavedCadAlgorithmsRoot(), algorithmDir)
  return { source, algorithmDir, calculatorPath, metadataPath }
}

function executePythonCalculator(
  calculatorPath: string,
  inputData: unknown,
): Promise<{
  stdout: string
  stderr: string
  result: unknown | null
  error: string | null
}> {
  const runner = [
    'import importlib.util, json, sys, traceback',
    'calculator_path = sys.argv[1]',
    'try:',
    '    raw = sys.stdin.read()',
    '    data = json.loads(raw) if raw.strip() else {}',
    '    spec = importlib.util.spec_from_file_location("xiaoliang_calculator", calculator_path)',
    '    module = importlib.util.module_from_spec(spec)',
    '    spec.loader.exec_module(module)',
    '    calc = getattr(module, "calc", None)',
    '    if calc is None:',
    '        raise RuntimeError("calculator.py must define calc(data: dict) -> dict")',
    '    result = calc(data)',
    `    print("${RESULT_MARKER}" + json.dumps(result, ensure_ascii=False), flush=True)`,
    'except Exception:',
    '    traceback.print_exc()',
    '    sys.exit(1)',
  ].join('\n')

  return new Promise((resolve) => {
    const started = spawn('python', ['-I', '-B', '-X', 'utf8', '-c', runner, calculatorPath], {
      cwd: path.dirname(calculatorPath),
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let finished = false
    const timeout = setTimeout(() => {
      if (!finished) {
        started.kill()
      }
    }, PYTHON_TIMEOUT_MS)

    started.stdout.setEncoding('utf-8')
    started.stderr.setEncoding('utf-8')
    started.stdout.on('data', (chunk: string) => {
      stdout = appendLimited(stdout, chunk)
    })
    started.stderr.on('data', (chunk: string) => {
      stderr = appendLimited(stderr, chunk)
    })
    started.stdin.on('error', () => {
      // The process may fail before stdin is fully written; close handling reports the real error.
    })
    started.stdin.end(`${JSON.stringify(inputData ?? {})}\n`, 'utf-8')
    started.on('error', (error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve({ stdout, stderr, result: null, error: error.message })
    })
    started.on('close', (code) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      if (code !== 0) {
        const timedOut = code === null
        resolve({
          stdout,
          stderr,
          result: null,
          error: timedOut ? `执行超时（${PYTHON_TIMEOUT_MS}ms）` : (stderr || stdout || `Python 退出码 ${code}`),
        })
        return
      }
      const result = parseMarkedResult(stdout)
      resolve({
        stdout,
        stderr,
        result: result.value,
        error: result.error,
      })
    })
  })
}

function parseMarkedResult(stdout: string): { value: unknown | null, error: string | null } {
  const markerIndex = stdout.lastIndexOf(RESULT_MARKER)
  if (markerIndex < 0) {
    return { value: null, error: '算法没有返回可解析结果。' }
  }
  const raw = stdout.slice(markerIndex + RESULT_MARKER.length).trim()
  try {
    return { value: JSON.parse(raw), error: null }
  } catch {
    return { value: null, error: '算法返回结果不是合法 JSON。' }
  }
}

function validateCalculatorOutput(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return '算法结果必须是对象。'
  }
  const record = result as Record<string, unknown>
  if (typeof record.result !== 'number' || !Number.isFinite(record.result)) {
    return '算法结果缺少数值字段 result。'
  }
  if (typeof record.unit !== 'string' || !record.unit.trim()) {
    return '算法结果缺少 unit。'
  }
  if (!Array.isArray(record.steps)) {
    return '算法结果缺少 steps 数组。'
  }
  if (!record.inputs_used || typeof record.inputs_used !== 'object' || Array.isArray(record.inputs_used)) {
    return '算法结果缺少 inputs_used 对象。'
  }
  return null
}

function normalizeCalculatorOutput(result: unknown, inputData: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result
  }

  const record = result as Record<string, unknown>
  const normalized: Record<string, unknown> = { ...record }
  const rawResult = normalized.result
  if (rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)) {
    const numericEntries = Object.entries(rawResult as Record<string, unknown>)
      .filter((entry): entry is [string, number] => {
        const value = entry[1]
        return typeof value === 'number' && Number.isFinite(value)
      })
    if (numericEntries.length === 1) {
      const [key, value] = numericEntries[0]
      normalized.result = value
      normalized.result_label = normalized.result_label ?? key
      normalized.result_breakdown = rawResult
    }
  }

  if (Array.isArray(normalized.inputs_used)) {
    const source = inputData && typeof inputData === 'object' && !Array.isArray(inputData)
      ? inputData as Record<string, unknown>
      : {}
    const mapped: Record<string, unknown> = {}
    normalized.inputs_used.forEach((item) => {
      if (typeof item !== 'string' || !item.trim()) {
        return
      }
      const key = item.trim()
      mapped[key] = source[key] ?? null
    })
    normalized.inputs_used = mapped
  }

  return normalized
}

function updateAlgorithmRunSnapshot(metadataPath: string, snapshot: AlgorithmRunSnapshot) {
  const metadata = readAlgorithmMetadata(metadataPath)
  if (!metadata) return
  const next: AlgorithmMetadata = {
    ...metadata,
    updated_at: snapshot.ran_at,
    last_run: snapshot,
  }
  fs.writeFileSync(metadataPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
}

function upsertAlgorithmManifestRecord(record: AlgorithmManifestRecord) {
  const manifest = readAlgorithmManifest()
  const nextAlgorithms = manifest.algorithms.filter((algorithm) => algorithm.slug !== record.slug)
  nextAlgorithms.push(record)
  const next: AlgorithmManifest = {
    version: ALGORITHM_MANIFEST_VERSION,
    updated_at: record.updated_at,
    algorithms: nextAlgorithms,
  }
  fs.mkdirSync(path.dirname(getSavedManifestPath()), { recursive: true })
  fs.writeFileSync(getSavedManifestPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
}

function readAlgorithmManifest(): AlgorithmManifest {
  const manifestPath = getSavedManifestPath()
  if (!fs.existsSync(manifestPath)) {
    return { version: ALGORITHM_MANIFEST_VERSION, updated_at: '', algorithms: [] }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as AlgorithmManifest
    return {
      version: ALGORITHM_MANIFEST_VERSION,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : '',
      algorithms: Array.isArray(parsed.algorithms)
        ? parsed.algorithms.flatMap((algorithm) => normalizeManifestRecord(algorithm))
        : [],
    }
  } catch {
    return { version: ALGORITHM_MANIFEST_VERSION, updated_at: '', algorithms: [] }
  }
}

function normalizeManifestRecord(raw: unknown): AlgorithmManifestRecord[] {
  if (!raw || typeof raw !== 'object') return []
  const record = raw as Partial<AlgorithmManifestRecord>
  if (
    typeof record.slug !== 'string'
    || typeof record.component_type !== 'string'
    || typeof record.version !== 'string'
    || typeof record.source_conversation_id !== 'string'
    || typeof record.created_at !== 'string'
    || typeof record.updated_at !== 'string'
    || typeof record.calculator_checksum !== 'string'
  ) {
    return []
  }
  return [{
    slug: record.slug,
    domain: 'cad',
    status: record.status === 'draft' ? 'draft' : 'saved',
    component_type: record.component_type,
    subtype_code: typeof record.subtype_code === 'string' && record.subtype_code.trim()
      ? record.subtype_code.trim()
      : undefined,
    drawing_name: typeof record.drawing_name === 'string' && record.drawing_name.trim()
      ? record.drawing_name.trim()
      : undefined,
    component_label: typeof record.component_label === 'string' && record.component_label.trim()
      ? record.component_label.trim()
      : undefined,
    version: record.version,
    source_conversation_id: record.source_conversation_id,
    created_at: record.created_at,
    updated_at: record.updated_at,
    confirmed_at: typeof record.confirmed_at === 'string' ? record.confirmed_at : undefined,
    confirmation_summary: typeof record.confirmation_summary === 'string' ? record.confirmation_summary : undefined,
    parameter_fields: Array.isArray(record.parameter_fields)
      ? record.parameter_fields.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    calculator_checksum: record.calculator_checksum,
    path: typeof record.path === 'string' ? record.path : path.posix.join('cad', record.slug, 'calculator.py'),
    last_run: record.last_run,
  }]
}

function readAlgorithmMetadata(metadataPath: string): AlgorithmMetadata | null {
  if (!fs.existsSync(metadataPath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as AlgorithmMetadata
    return {
      ...parsed,
      subtype_code: normalizeOptionalText(parsed.subtype_code),
      drawing_name: normalizeOptionalText(parsed.drawing_name),
      component_label: normalizeOptionalText(parsed.component_label),
    }
  } catch {
    return null
  }
}

function getAlgorithmsDataRoot() {
  const override = process.env.XIAOLIANG_ALGORITHMS_USER_DATA_DIR?.trim()
  const userData = override || process.env.XIAOLIANG_SKILLS_USER_DATA_DIR?.trim() || app.getPath('userData')
  return path.join(userData, 'algorithms')
}

function getDraftCadAlgorithmsRoot() {
  return path.join(getAlgorithmsDataRoot(), 'drafts', 'cad')
}

function getSavedCadAlgorithmsRoot() {
  return path.join(getAlgorithmsDataRoot(), 'cad')
}

function getSavedManifestPath() {
  return path.join(getAlgorithmsDataRoot(), 'manifest.json')
}

function normalizeSlug(raw: string) {
  const slug = raw.trim().toLowerCase()
  if (!ALGORITHM_SLUG_PATTERN.test(slug)) {
    throw new Error('algorithm_slug 非法。仅允许小写字母、数字和中划线，长度 2-81。')
  }
  return slug
}

function validateCalculatorCode(code: string) {
  const normalized = code.trim()
  if (!normalized) {
    throw new Error('calculator_code 不能为空。')
  }
  if (!/def\s+calc\s*\(\s*data\s*:\s*dict\s*\)\s*->\s*dict\s*:/.test(normalized)) {
    throw new Error('calculator.py 必须定义 def calc(data: dict) -> dict。')
  }
  const blockedPatterns = [
    /\bimport\s+(os|subprocess|socket|shutil|pathlib|ctypes|multiprocessing|requests|urllib|http|ftplib|glob|tempfile)\b/,
    /\bfrom\s+(os|subprocess|socket|shutil|pathlib|ctypes|multiprocessing|requests|urllib|http|ftplib|glob|tempfile)\s+import\b/,
    /\b(open|eval|exec|compile|__import__|input)\s*\(/,
  ]
  for (const pattern of blockedPatterns) {
    if (pattern.test(normalized)) {
      throw new Error('calculator_code 包含不允许的文件、网络或动态执行能力。')
    }
  }
}

function detectHardcodedNumericRisk(code: string) {
  const allowed = new Set(['0', '1', '2', '3', '6', '1000', '1000000000'])
  const matches = code.match(/\b\d{3,}(?:\.\d+)?\b/g) ?? []
  const risky = [...new Set(matches)]
    .filter((item) => !allowed.has(item))
    .slice(0, 12)
  return risky.length
    ? [`检测到较大的数字字面量：${risky.join(', ')}。请确认这些不是样本尺寸硬编码。`]
    : []
}

function extractComponentType(parameterContract: unknown) {
  const normalized = normalizeJsonLike(parameterContract)
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return ''
  }
  const record = normalized as Record<string, unknown>
  for (const key of ['component_type', 'componentType', 'component']) {
    if (typeof record[key] === 'string' && record[key].trim()) {
      return record[key].trim()
    }
  }
  return ''
}

function extractParameterFields(parameterContract: unknown): string[] {
  const normalized = normalizeJsonLike(parameterContract)
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return []
  }
  const record = normalized as Record<string, unknown>
  const candidates = [record.fields, record.parameters, record.required_params, record.requiredParams]
  const fields = new Set<string>()
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === 'string') {
          const value = item.trim()
          if (value) fields.add(value)
        } else if (item && typeof item === 'object') {
          const itemRecord = item as Record<string, unknown>
          const value = String(itemRecord.name || itemRecord.key || itemRecord.id || '').trim()
          if (value) fields.add(value)
        }
      }
      continue
    }

    if (candidate && typeof candidate === 'object') {
      Object.keys(candidate as Record<string, unknown>).forEach((key) => {
        const value = key.trim()
        if (value) fields.add(value)
      })
    }
  }
  return [...fields].slice(0, 48)
}

function normalizeJsonLike(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return value
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized : undefined
}

function copyAlgorithmFiles(sourceDir: string, targetDir: string) {
  for (const fileName of ['calculator.py', 'parameter_contract.json', 'validation_cases.json']) {
    const source = path.join(sourceDir, fileName)
    if (!fs.existsSync(source)) {
      throw new Error(`算法草稿缺少 ${fileName}。`)
    }
    fs.copyFileSync(source, path.join(targetDir, fileName))
  }
}

function assertInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('目标路径超出允许目录。')
  }
}

function appendLimited(current: string, chunk: string) {
  const combined = current + chunk
  return combined.length > MAX_OUTPUT_CHARS
    ? combined.slice(combined.length - MAX_OUTPUT_CHARS)
    : combined
}

function sha256Text(content: string) {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex')
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
