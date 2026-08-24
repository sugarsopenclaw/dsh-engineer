const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const { MessageProcessor } = require('@a2ui/web_core/v0_9')
const { basicCatalog } = require('@copilotkit/a2ui-renderer')

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

function toolContext(toolName, args, id = `call-${toolName}`) {
  return {
    assistantMessage: {},
    toolCall: { type: 'toolCall', id, name: toolName, arguments: args },
    args,
    context: { systemPrompt: '', messages: [], tools: [] },
  }
}

function component(overrides = {}) {
  return {
    identity: {
      component_type: '独立基础',
      semantic_name: 'J-1 独立基础',
    },
    anchors: {
      drawing_relpath: '结构/基础平面图.dwg',
      layout_name: 'Model',
      source_handles: [{ handle: '1A2B' }, { handle: '1A2C' }],
    },
    quantities: {
      dimensions: { length: 2400, width: 2400, height: 600 },
      items: [{ name: '混凝土体积', value: 3.456, unit: 'm³' }],
    },
    semantics: { description: '基础构件' },
    evidence: { evidence_pack: 'cad-evidence/run-1/evidence.md' },
    ...overrides,
  }
}

function responseTokenFrom(interaction, actionName) {
  const update = interaction.a2uiMessages.find((message) => message.updateComponents)
  const button = update.updateComponents.components.find(
    (item) => item.component === 'Button' && item.action?.event?.name === actionName,
  )
  return button.action.event.context.responseToken
}

test('confirmation policy only gates protected mutations', () => {
  const policy = loadBundledModule('electron/runtime/agent/policy/approval-gates.ts')

  assert.equal(
    policy.getToolConfirmationRequest(toolContext('component_save', {
      status: 'draft',
      components: [component()],
    })),
    null,
  )
  const confirmed = policy.getToolConfirmationRequest(toolContext('component_save', {
    status: 'confirmed',
    components: [component()],
  }))
  assert.equal(confirmed.title, '确认构件入库')
  const componentDetail = confirmed.details.find((item) => item.label === '构件 1').value
  assert.match(componentDetail, /J-1 独立基础/)
  assert.match(componentDetail, /1A2B/)
  assert.match(componentDetail, /3\.456m³/)
  assert.doesNotMatch(componentDetail, /cad-evidence\/run-1/)
  assert.equal(confirmed.details.some((item) => item.label === '保存状态'), false)

  const overwrite = policy.getToolConfirmationRequest(toolContext('component_save', {
    status: 'confirmed',
    overwrite_confirmed: true,
    components: [component()],
  }))
  assert.equal(overwrite.risk, 'high')
  assert.match(overwrite.title, /覆盖/)

  assert.equal(
    policy.getToolConfirmationRequest(toolContext('project_artifact_create', {
      format: 'docx',
      path: 'reports/result.docx',
      overwrite_confirmed: false,
    })),
    null,
  )
  assert.match(
    policy.getToolConfirmationRequest(toolContext('project_artifact_create', {
      format: 'docx',
      path: 'reports/result.docx',
      overwrite_confirmed: true,
    })).title,
    /覆盖已有项目产物/,
  )
  assert.match(
    policy.getToolConfirmationRequest(toolContext('component_delete', {
      component_id: 'component-1',
    })).title,
    /永久删除/,
  )
  assert.match(
    policy.getToolConfirmationRequest(toolContext('cad_algorithm_save', {
      algorithm_slug: 'footing-v1',
      confirmation_summary: '体积与截图校验通过',
    })).title,
    /保存算法资产/,
  )
  assert.equal(
    policy.getToolConfirmationRequest(toolContext('project_algorithm_export', {
      algorithm_slug: 'footing-v1',
      overwrite_confirmed: false,
    })),
    null,
  )
  assert.match(
    policy.getToolConfirmationRequest(toolContext('project_algorithm_export', {
      algorithm_slug: 'footing-v1',
      overwrite_confirmed: true,
    })).title,
    /覆盖算法导出文件/,
  )
  assert.equal(
    policy.getToolConfirmationRequest(toolContext('component_update', {
      component_id: 'component-1',
      patch: { semantics: { description: '更新' } },
    })),
    null,
  )
  assert.equal(policy.getToolConfirmationRequest(toolContext('doc_parse', { path: 'a.pdf' })), null)
  assert.equal(policy.getToolConfirmationRequest(toolContext('read', { path: 'a.md' })), null)
})

test('approval payload hash source is stable across object key order', () => {
  const policy = loadBundledModule('electron/runtime/agent/policy/approval-gates.ts')
  const left = policy.serializeToolApprovalPayload(toolContext(
    'project_artifact_create',
    { path: 'a.md', metadata: { b: 2, a: 1 }, overwrite_confirmed: true },
    'call-1',
  ))
  const right = policy.serializeToolApprovalPayload(toolContext(
    'project_artifact_create',
    { overwrite_confirmed: true, metadata: { a: 1, b: 2 }, path: 'a.md' },
    'call-1',
  ))
  assert.equal(left, right)
})

test('A2UI confirmation surface validates and a one-time confirm releases the wait', async () => {
  const { InteractionCoordinator, INTERACTION_CONFIRM_ACTION } = loadBundledModule(
    'electron/runtime/agent/interactions/interaction-coordinator.ts',
  )
  const events = []
  const audit = []
  const coordinator = new InteractionCoordinator(
    (event) => events.push(event),
    1_000,
    {
      recordRequested: (interaction) => audit.push({ type: 'requested', value: interaction }),
      recordResolved: (resolution) => audit.push({ type: 'resolved', value: resolution }),
    },
  )
  const waiting = coordinator.waitForConfirmation({
    conversationId: 'conversation-1',
    toolCallId: 'tool-call-1',
    toolName: 'cad_algorithm_save',
    payloadHash: 'hash-1',
    request: {
      title: '确认保存算法资产',
      description: '验证后保存。',
      risk: 'medium',
      confirmLabel: '确认保存',
      cancelLabel: '取消',
      details: [{ label: '算法', value: 'footing-v1' }],
    },
  })
  const interaction = coordinator.getPendingInteraction('conversation-1')
  assert.ok(interaction)

  const processor = new MessageProcessor([basicCatalog], () => {})
  processor.processMessages(interaction.a2uiMessages)
  assert.ok(processor.model.getSurface(interaction.surfaceId))
  const update = interaction.a2uiMessages.find((message) => message.updateComponents)
  const components = update.updateComponents.components
  assert.equal(components.find((item) => item.id === 'root').component, 'Column')
  assert.equal(components.some((item) => item.component === 'Card'), false)
  assert.equal(components.some((item) => item.component === 'Divider'), false)

  const responseToken = responseTokenFrom(interaction, INTERACTION_CONFIRM_ACTION)
  assert.throws(() => coordinator.resolveInteraction({
    conversationId: 'conversation-1',
    interactionId: interaction.id,
    responseToken: 'invalid-token',
    actionId: INTERACTION_CONFIRM_ACTION,
  }), /令牌无效/)
  assert.equal(coordinator.getPendingInteraction('conversation-1').id, interaction.id)
  const resolution = coordinator.resolveInteraction({
    conversationId: 'conversation-1',
    interactionId: interaction.id,
    responseToken,
    actionId: INTERACTION_CONFIRM_ACTION,
  })
  const outcome = await waiting
  assert.equal(resolution.status, 'confirmed')
  assert.equal(outcome.approved, true)
  assert.equal(coordinator.getPendingInteraction('conversation-1'), null)
  assert.deepEqual(events.map((event) => event.type), [
    'interaction_requested',
    'interaction_resolved',
  ])
  assert.deepEqual(audit.map((entry) => entry.type), ['requested', 'resolved'])
  assert.equal(audit[0].value.payloadHash, 'hash-1')
  assert.equal(audit[1].value.status, 'confirmed')
  assert.throws(() => coordinator.resolveInteraction({
    conversationId: 'conversation-1',
    interactionId: interaction.id,
    responseToken,
    actionId: INTERACTION_CONFIRM_ACTION,
  }), /失效/)
})

test('cancel, timeout, and abort all fail closed', async () => {
  const {
    InteractionCoordinator,
    INTERACTION_CANCEL_ACTION,
  } = loadBundledModule('electron/runtime/agent/interactions/interaction-coordinator.ts')
  const request = {
    title: '确认永久删除构件',
    description: '不可恢复。',
    risk: 'high',
    confirmLabel: '永久删除',
    cancelLabel: '取消',
    details: [{ label: 'component_id', value: 'component-1' }],
  }

  const cancelledCoordinator = new InteractionCoordinator(() => {}, 1_000)
  const cancelledWait = cancelledCoordinator.waitForConfirmation({
    conversationId: 'cancel-conversation',
    toolCallId: 'call-cancel',
    toolName: 'component_delete',
    payloadHash: 'hash-cancel',
    request,
  })
  const cancelledInteraction = cancelledCoordinator.getPendingInteraction('cancel-conversation')
  cancelledCoordinator.resolveInteraction({
    conversationId: 'cancel-conversation',
    interactionId: cancelledInteraction.id,
    responseToken: responseTokenFrom(cancelledInteraction, INTERACTION_CANCEL_ACTION),
    actionId: INTERACTION_CANCEL_ACTION,
  })
  assert.equal((await cancelledWait).approved, false)

  const timeoutCoordinator = new InteractionCoordinator(() => {}, 10)
  const timeoutResult = await timeoutCoordinator.waitForConfirmation({
    conversationId: 'timeout-conversation',
    toolCallId: 'call-timeout',
    toolName: 'component_delete',
    payloadHash: 'hash-timeout',
    request,
  })
  assert.equal(timeoutResult.approved, false)
  assert.equal(timeoutResult.resolution.status, 'expired')

  const abortController = new AbortController()
  const abortCoordinator = new InteractionCoordinator(() => {}, 1_000)
  const abortWait = abortCoordinator.waitForConfirmation({
    conversationId: 'abort-conversation',
    toolCallId: 'call-abort',
    toolName: 'component_delete',
    payloadHash: 'hash-abort',
    request,
    signal: abortController.signal,
  })
  abortController.abort()
  const abortResult = await abortWait
  assert.equal(abortResult.approved, false)
  assert.equal(abortResult.resolution.status, 'aborted')
})

test('database migration declares the interaction audit store and indexes', () => {
  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'electron/runtime/db/schema.ts'),
    'utf8',
  )
  assert.match(schemaSource, /SCHEMA_VERSION\s*=\s*39/)
  assert.match(schemaSource, /client_run_id\s+TEXT/)
  assert.match(schemaSource, /ALTER TABLE messages ADD COLUMN client_run_id TEXT/)
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS agent_interaction_audit/)
  for (const column of [
    'conversation_id',
    'tool_call_id',
    'tool_name',
    'payload_hash',
    'kind',
    'risk',
    'details_json',
    'status',
    'action_id',
    'expires_at',
    'resolved_at',
  ]) {
    assert.match(schemaSource, new RegExp(`\\b${column}\\b`))
  }
  assert.match(schemaSource, /idx_agent_interaction_audit_conversation/)
  assert.match(schemaSource, /idx_agent_interaction_audit_status/)
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS conversation_plan_mode/)
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS conversation_pending_interactions/)
})

function memoryPersistentStore(seed = []) {
  const records = new Map(seed.map((item) => [item.conversationId, item]))
  return {
    upsert(record) { records.set(record.conversationId, record) },
    remove(conversationId) { records.delete(conversationId) },
    list() { return [...records.values()] },
    get(conversationId) { return records.get(conversationId) ?? null },
  }
}

test('persistent plan approval is not cleared by cancelConversation and fail-closes unknown actions', async () => {
  const {
    InteractionCoordinator,
    INTERACTION_PLAN_APPROVE_ACTION,
    INTERACTION_PLAN_REVISE_ACTION,
  } = loadBundledModule(
    'electron/runtime/agent/interactions/interaction-coordinator.ts',
  )

  const store = memoryPersistentStore()
  const events = []
  const coordinator = new InteractionCoordinator((event) => events.push(event), 20, undefined, store)
  const waiting = coordinator.waitForPersistentDecision({
    conversationId: 'plan-1',
    kind: 'plan_approval',
    title: '审批计划',
    description: '核对后开工',
    payload: { planContent: '# 计划', planFilePath: '/tmp/plan.md' },
  })

  assert.equal(coordinator.getPendingInteraction('plan-1').kind, 'plan_approval')
  coordinator.cancelConversation('plan-1')
  assert.equal(coordinator.getPendingInteraction('plan-1').kind, 'plan_approval')

  const pending = coordinator.getPendingInteraction('plan-1')
  const unknown = coordinator.resolveInteraction({
    conversationId: 'plan-1',
    interactionId: pending.id,
    responseToken: pending.responseToken,
    actionId: INTERACTION_PLAN_REVISE_ACTION,
    data: { feedback: '补风险' },
  })
  const decision = await waiting
  assert.equal(unknown.status, 'cancelled')
  assert.equal(decision.actionId, INTERACTION_PLAN_REVISE_ACTION)
  assert.equal(decision.data.feedback, '补风险')
  assert.equal(coordinator.getPendingInteraction('plan-1'), null)

  const restoredStore = memoryPersistentStore([{
    conversationId: 'plan-2',
    interaction: {
      id: 'interaction-restored',
      conversationId: 'plan-2',
      surfaceId: 'surface-restored',
      kind: 'plan_approval',
      toolCallId: 'runtime-plan_approval',
      toolName: 'exit_plan_mode',
      payloadHash: 'hash',
      title: '恢复审批',
      description: '',
      risk: 'medium',
      details: [],
      a2uiMessages: [],
      createdAt: new Date().toISOString(),
      expiresAt: '2099-01-01T00:00:00.000Z',
      persistence: 'persistent',
      responseToken: 'token-restored',
      payload: { planContent: '# 恢复', planFilePath: '/tmp/plan.md', restored: true },
    },
    responseToken: 'token-restored',
    allowedActions: [INTERACTION_PLAN_APPROVE_ACTION, INTERACTION_PLAN_REVISE_ACTION],
  }])
  const restored = new InteractionCoordinator(() => {}, 20, undefined, restoredStore)
  restored.restorePersistentInteractions()
  const restoredPending = restored.getPendingInteraction('plan-2')
  assert.equal(restoredPending.kind, 'plan_approval')
  assert.equal(restoredPending.payload.restored, true)
})

test('aborting a live persistent approval removes its restart record', async () => {
  const { InteractionCoordinator } = loadBundledModule(
    'electron/runtime/agent/interactions/interaction-coordinator.ts',
  )
  const store = memoryPersistentStore()
  const abortController = new AbortController()
  const coordinator = new InteractionCoordinator(() => {}, 1_000, undefined, store)
  const waiting = coordinator.waitForPersistentDecision({
    conversationId: 'plan-abort',
    kind: 'plan_approval',
    title: '审批计划',
    description: '等待审批',
    payload: { planContent: '# 计划', planFilePath: '/tmp/plan.md' },
    signal: abortController.signal,
  })

  assert.ok(store.get('plan-abort'))
  abortController.abort()
  const decision = await waiting
  assert.equal(decision.status, 'aborted')
  assert.equal(decision.actionId, 'system.abort')
  assert.equal(store.get('plan-abort'), null)
  assert.equal(coordinator.getPendingInteraction('plan-abort'), null)

  const restored = new InteractionCoordinator(() => {}, 1_000, undefined, store)
  restored.restorePersistentInteractions()
  assert.equal(restored.getPendingInteraction('plan-abort'), null)
})
