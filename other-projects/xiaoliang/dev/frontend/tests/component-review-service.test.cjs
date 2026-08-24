const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

function loadBundledModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function record(overrides = {}) {
  return {
    schema_version: 'xiaoliang-component-v1',
    component_id: '11111111-1111-1111-1111-111111111111',
    source_key: 'abc',
    status: 'draft',
    identity: { component_type: '独立基础', semantic_name: 'J-1' },
    anchors: {
      drawing_relpath: '结构/基础.dwg',
      source_handles: [{ handle: '1A2B' }],
    },
    quantities: {
      dimensions: { length: 2400 },
      items: [{ name: '混凝土体积', value: 3.2, unit: 'm³' }],
    },
    semantics: { description: '独立基础' },
    evidence: { evidence_pack: 'cad-evidence/run-1/evidence.md' },
    provenance: {
      created_by: 'agent',
      created_at: '2026-08-15T00:00:00.000Z',
      updated_at: '2026-08-15T00:00:00.000Z',
    },
    ...overrides,
  }
}

test('review trigger covers draft, extract and opt-out skip', () => {
  const review = loadBundledModule('electron/runtime/agent/review/component-review-service.ts')
  assert.equal(review.detectReviewTrigger({
    savedDraft: true,
    savedConfirmed: false,
    usedCadEvidence: true,
    usedRead: true,
    userOptOut: false,
  }), 'draft_records')
  // Delegation-only turn: the evidence pack has not been read back yet.
  assert.equal(review.detectReviewTrigger({
    savedDraft: false,
    savedConfirmed: false,
    usedCadEvidence: true,
    usedRead: false,
    userOptOut: false,
  }), 'skip')
  assert.equal(review.detectReviewTrigger({
    savedDraft: false,
    savedConfirmed: false,
    usedCadEvidence: false,
    usedRead: true,
    userOptOut: false,
  }), 'skip')
  assert.equal(review.detectReviewTrigger({
    savedDraft: false,
    savedConfirmed: false,
    usedCadEvidence: true,
    usedRead: true,
    userOptOut: false,
  }), 'extract')
  assert.equal(review.detectReviewTrigger({
    savedDraft: false,
    savedConfirmed: true,
    usedCadEvidence: true,
    usedRead: true,
    userOptOut: false,
  }), 'skip')
  assert.equal(review.detectReviewTrigger({
    savedDraft: true,
    savedConfirmed: false,
    usedCadEvidence: true,
    usedRead: true,
    userOptOut: true,
  }), 'skip')
})

test('extract triggers for components outside the probe keyword table', () => {
  const review = loadBundledModule('electron/runtime/agent/review/component-review-service.ts')
  const trigger = review.detectReviewTriggerFromTurn({
    messages: [
      { role: 'user', content: '我们可以看电梯基坑做法吗' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', name: 'delegate_cad', arguments: { task: '取证' } },
          { type: 'toolCall', name: 'read', arguments: { path: 'evidence.md' } },
        ],
      },
    ],
    userText: '我们可以看电梯基坑做法吗',
  })
  assert.equal(trigger, 'extract')
})

test('review confirmation is restricted to ids from the signed payload', () => {
  const review = loadBundledModule('electron/runtime/agent/review/component-review-service.ts')
  const item = review.buildReviewItems([record()], new Set())[0]
  const payload = { projectId: 'project-1', items: [item], source: 'draft_records' }
  assert.deepEqual(
    review.selectReviewedComponentIds(
      ['unrelated-draft', item.componentId, item.componentId, 42],
      payload,
    ),
    [item.componentId],
  )
})

test('draft review only includes records created by the current turn', async () => {
  const review = loadBundledModule('electron/runtime/agent/review/component-review-service.ts')
  const current = record({
    component_id: '22222222-2222-2222-2222-222222222222',
    source_key: 'current',
    provenance: {
      ...record().provenance,
      run_id: 'run-current',
    },
  })
  const stale = record({
    component_id: '33333333-3333-3333-3333-333333333333',
    source_key: 'stale',
    provenance: {
      ...record().provenance,
      run_id: 'run-old',
      updated_at: '2026-08-14T00:00:00.000Z',
    },
  })
  const records = new Map([
    [current.component_id, current],
    [stale.component_id, stale],
  ])
  const payload = await review.maybeBuildComponentReview({
    projectId: 'project-1',
    messages: [
      { role: 'user', content: '保存草稿' },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          name: 'component_save',
          arguments: { status: 'draft', components: [{}] },
        }],
      },
    ],
    userText: '保存草稿',
    assistantText: '已保存',
    clientRunId: 'run-current',
    turnStartedAt: '2026-08-15T00:00:00.000Z',
    deps: {
      listComponents: async (_projectId, filter) => filter?.status === 'confirmed'
        ? []
        : [...records.values()].map((item) => ({
          component_id: item.component_id,
          source_key: item.source_key,
          status: item.status,
        })),
      getComponent: async (_projectId, componentId) => records.get(componentId),
      saveDrafts: async () => [],
      extractComponents: async () => '{"components":[]}',
    },
  })

  assert.deepEqual(payload.items.map((item) => item.componentId), [current.component_id])
})

test('turn inspection reads component_save status and review items mark overwrite', () => {
  const review = loadBundledModule('electron/runtime/agent/review/component-review-service.ts')
  const inspection = review.inspectTurnToolActivity([
    { role: 'user', content: '看这个独立基础' },
    {
      role: 'assistant',
      content: [{
        type: 'toolCall',
        name: 'component_save',
        arguments: { status: 'draft', components: [{}] },
      }],
    },
  ])
  assert.equal(inspection.savedDraft, true)
  assert.equal(inspection.savedConfirmed, false)

  const items = review.buildReviewItems([record()], new Set(['abc']))
  assert.equal(items[0].name, 'J-1')
  assert.equal(items[0].wouldOverwriteConfirmed, true)
  assert.match(items[0].dimensions, /2400/)
})

test('extraction parser accepts fenced JSON and rejects empty objects', () => {
  const extraction = loadBundledModule(
    'electron/runtime/agent/prompts/review/component-review-extraction.ts',
  )
  const parsed = extraction.parseExtractedComponents(`
\`\`\`json
{"components":[{
  "identity":{"component_type":"独立基础","semantic_name":"J-1"},
  "anchors":{"drawing_relpath":"基础.dwg","source_handles":[{"handle":"AA"}]},
  "semantics":{"description":"独立基础"}
}]}
\`\`\`
`)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].identity.component_type, '独立基础')
  assert.deepEqual(extraction.parseExtractedComponents('not json'), [])
})

test('queued subagent completions stay inside the genuine CAD review window', () => {
  const review = loadBundledModule('electron/runtime/agent/review/component-review-service.ts')
  const turnWindow = loadBundledModule('electron/runtime/agent/review/turn-window.ts')
  const completion = loadBundledModule('src/shared/subagent-completion.ts')
  const firstCompletion = completion.buildSubagentCompletionPrompt({
    parentPromptId: 'prompt-1',
    completions: [{
      taskId: 'child-1',
      agentType: 'cad-analyst',
      status: 'completed',
      payload: 'evidence pack 1',
    }],
  })
  const secondCompletion = completion.buildSubagentCompletionPrompt({
    parentPromptId: 'prompt-1',
    completions: [{
      taskId: 'child-2',
      agentType: 'cad-analyst',
      status: 'completed',
      payload: 'evidence pack 2',
    }],
  })
  const messages = [
    { role: 'user', content: '查一下独立基础 J-1 和电梯基坑的尺寸' },
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', name: 'delegate_cad', arguments: { task: 'J-1' } },
        { type: 'toolCall', name: 'delegate_cad', arguments: { task: '基坑' } },
      ],
    },
    { role: 'user', content: firstCompletion },
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', name: 'read', arguments: { path: 'pack-1/evidence.md' } },
        { type: 'text', text: 'J-1 独立基础 2400x2400' },
      ],
    },
    { role: 'user', content: secondCompletion },
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', name: 'read', arguments: { path: 'pack-2/evidence.md' } },
        { type: 'text', text: '电梯基坑深度 1800' },
      ],
    },
  ]

  assert.equal(turnWindow.getGenuineUserText(messages), '查一下独立基础 J-1 和电梯基坑的尺寸')
  assert.equal(turnWindow.findGenuineTurnStartIndex(messages), 1)
  assert.match(turnWindow.collectTurnAssistantText(messages), /J-1 独立基础/)
  assert.match(turnWindow.collectTurnAssistantText(messages), /电梯基坑深度/)
  assert.equal(review.detectReviewTriggerFromTurn({
    messages,
    userText: turnWindow.getGenuineUserText(messages),
  }), 'extract')
  const inspection = review.inspectTurnToolActivity(messages)
  assert.equal(inspection.toolNames.has('delegate_cad'), true)
  assert.equal(inspection.toolNames.has('read'), true)
})

test('maybeBuildComponentReview promotes extracted text into draft records', async () => {
  const review = loadBundledModule('electron/runtime/agent/review/component-review-service.ts')
  const saved = []
  const payload = await review.maybeBuildComponentReview({
    projectId: 'project-1',
    messages: [
      { role: 'user', content: '这个独立基础怎么算' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', name: 'delegate_cad', arguments: { task: '取证' } },
          { type: 'toolCall', name: 'read', arguments: { path: 'evidence.md' } },
          { type: 'text', text: 'J-1 独立基础 2400x2400' },
        ],
      },
    ],
    userText: '这个独立基础怎么算',
    assistantText: 'J-1 独立基础尺寸 2400',
    deps: {
      listComponents: async (_projectId, filter) => (
        filter?.status === 'confirmed' ? [] : []
      ),
      getComponent: async () => record(),
      saveDrafts: async (_projectId, components) => {
        saved.push(components)
        return [{ component: { component_id: record().component_id } }]
      },
      extractComponents: async () => JSON.stringify({
        components: [{
          identity: { component_type: '独立基础' },
          anchors: { drawing_relpath: '', source_handles: [] },
          semantics: { description: '独立基础' },
        }],
      }),
    },
  })
  assert.equal(payload.source, 'extracted')
  assert.equal(payload.items.length, 1)
  assert.equal(saved.length, 1)
})
