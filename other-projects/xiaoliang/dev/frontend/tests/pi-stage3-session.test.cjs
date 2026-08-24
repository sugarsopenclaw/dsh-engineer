const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const Database = require('better-sqlite3')
const esbuild = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')

function loadBundledModule(relativePath, userDataDir) {
  const filename = path.join(projectRoot, relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'better-sqlite3'],
    banner: {
      js: "const __bundledImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
    },
    define: {
      'import.meta.url': '__bundledImportMetaUrl',
    },
    write: false,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: () => userDataDir,
          isReady: () => false,
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const mod = new Module(filename, module)
    mod.filename = filename
    mod.paths = Module._nodeModulePaths(path.dirname(filename))
    mod._compile(output.outputFiles[0].text, filename)
    return mod.exports
  } finally {
    Module._load = originalLoad
  }
}

function assistantMessage(text, timestamp) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'xiaoliang-managed',
    model: 'qwen3.8-max',
    stopReason: 'stop',
    usage: {
      input: 12,
      output: 4,
      cacheRead: 1,
      cacheWrite: 0,
      totalTokens: 17,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp,
  }
}

test('stage 3 migrates legacy state into JSONL and can rebuild the SQLite projection', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-pi-stage3-'))
  const repository = loadBundledModule(
    'electron/runtime/conversations/conversation-repository.ts',
    userDataDir,
  )
  const store = loadBundledModule(
    'electron/runtime/agent/pi/pi-session-store.ts',
    userDataDir,
  )

  const project = repository.createProject('Pi 迁移测试')
  const conversation = repository.createConversationInProject(project.id, '迁移测试')
  const legacyMessages = [
    {
      role: 'user',
      content: [{ type: 'text', text: '旧对话问题' }],
      timestamp: 1_700_000_000_000,
    },
    assistantMessage('旧对话回答', 1_700_000_001_000),
  ]
  repository.persistConversationState(
    conversation.id,
    conversation.title,
    legacyMessages,
    {
      compaction: {
        version: 1,
        reason: 'legacy-threshold',
        createdAt: new Date(1_700_000_002_000).toISOString(),
        beforeMessages: 8,
        afterMessages: 2,
        beforeTokens: 9000,
        afterTokens: 1200,
        projectedTokens: 1300,
        summaryChars: 300,
        retainedTailTurns: 1,
        retainedUserAnchors: 1,
      },
    },
  )

  const dbPath = path.join(userDataDir, 'xiaoliang-local-agent.db')
  const inspector = new Database(dbPath)
  const legacyStateBefore = inspector
    .prepare('SELECT agent_state FROM conversations WHERE id = ?')
    .pluck()
    .get(conversation.id)
  const legacyIds = repository.buildStableMessageRecordIds(
    conversation.id,
    legacyMessages,
  )

  const prepared = store.prepareConversationPiSession({
    conversationId: conversation.id,
    title: conversation.title,
    cwd: userDataDir,
    agentDir: path.join(userDataDir, 'pi-runtime'),
    modelProvider: 'xiaoliang-managed',
    modelId: 'qwen3.8-max',
    thinkingLevel: 'xhigh',
  })

  assert.equal(prepared.binding.migrationStatus, 'ready')
  assert.equal(prepared.migratedLegacyMessages, true)
  assert.equal(fs.existsSync(prepared.binding.piSessionFile), true)
  assert.equal(
    inspector.prepare('SELECT agent_state FROM conversations WHERE id = ?').pluck().get(conversation.id),
    legacyStateBefore,
    'legacy agent_state must remain a read-only backup',
  )

  const jsonlEntries = fs.readFileSync(prepared.binding.piSessionFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(jsonlEntries[0].type, 'session')
  assert.equal(jsonlEntries[0].id, prepared.binding.piSessionId)
  assert.ok(jsonlEntries.some((entry) => (
    entry.type === 'custom'
    && entry.customType === store.LEGACY_CHECKPOINT_CUSTOM_TYPE
    && entry.data.historyBeforeLegacyCompactionRecoverable === false
  )))
  assert.equal(jsonlEntries.filter((entry) => entry.type === 'message').length, 2)

  const projected = repository.getDisplayMessageRecords(conversation.id)
  assert.deepEqual(projected.map((message) => message.content), [
    '旧对话问题',
    '旧对话回答',
  ])
  assert.ok(projected.every((message) => (
    message.id.startsWith(`pi:${prepared.binding.piSessionId}:`)
  )))
  assert.equal(
    repository.resolveExternalMessageId(conversation.id, projected[0].id),
    legacyIds[0],
  )
  assert.equal(
    repository.resolveCanonicalMessageId(conversation.id, legacyIds[1]),
    projected[1].id,
  )

  prepared.sessionManager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: '重启后继续' }],
    timestamp: 1_700_000_003_000,
  })
  prepared.sessionManager.appendMessage(assistantMessage('继续回答', 1_700_000_004_000))
  store.rebuildConversationPiProjection({
    conversationId: conversation.id,
    title: conversation.title,
    sessionManager: prepared.sessionManager,
  })
  assert.equal(repository.getDisplayMessageRecords(conversation.id).length, 4)

  inspector.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversation.id)
  assert.equal(repository.getDisplayMessageRecords(conversation.id).length, 0)
  inspector.prepare("UPDATE conversations SET updated_at = '2001-02-03 04:05:06' WHERE id = ?")
    .run(conversation.id)
  const reopened = store.prepareConversationPiSession({
    conversationId: conversation.id,
    title: conversation.title,
    cwd: userDataDir,
    agentDir: path.join(userDataDir, 'pi-runtime'),
    modelProvider: 'xiaoliang-managed',
    modelId: 'qwen3.8-max',
    thinkingLevel: 'low',
  })
  assert.equal(reopened.binding.piSessionId, prepared.binding.piSessionId)
  assert.equal(
    inspector.prepare('SELECT updated_at FROM conversations WHERE id = ?').pluck().get(conversation.id),
    '2001-02-03 04:05:06',
    'opening a session must not reorder the conversation list',
  )
  assert.equal(repository.getDisplayMessageRecords(conversation.id).length, 4)
  assert.deepEqual(
    reopened.sessionManager.buildSessionContext().messages.map((message) => message.role),
    ['user', 'assistant', 'user', 'assistant'],
  )
  assert.equal(reopened.sessionManager.buildSessionContext().thinkingLevel, 'xhigh')

  const exportPath = path.join(userDataDir, 'exports', 'session.jsonl')
  store.exportPiSessionToJsonl(reopened.sessionManager, exportPath)
  assert.equal(fs.existsSync(exportPath), true)
  assert.throws(
    () => store.exportPiSessionToJsonl(
      reopened.sessionManager,
      reopened.sessionManager.getSessionFile(),
    ),
    /不能覆盖当前 Pi session/,
  )
  const imported = store.importConversationPiSession({
    sourceFile: exportPath,
    cwd: userDataDir,
    agentDir: path.join(userDataDir, 'pi-runtime'),
    title: '导入副本',
  })
  assert.notEqual(imported.getSessionId(), reopened.sessionManager.getSessionId())
  assert.equal(imported.buildSessionContext().messages.length, 4)
  assert.equal(fs.existsSync(imported.getSessionFile()), true)

  const stats = store.summarizePiSession(reopened.sessionManager)
  assert.deepEqual(
    {
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
      totalMessages: stats.totalMessages,
      input: stats.tokens.input,
      output: stats.tokens.output,
    },
    {
      userMessages: 2,
      assistantMessages: 2,
      totalMessages: 4,
      input: 24,
      output: 8,
    },
  )

  const guardedConversation = repository.createConversationInProject(project.id, '事实源保护')
  repository.persistConversationState(
    guardedConversation.id,
    guardedConversation.title,
    [{
      role: 'user',
      content: [{ type: 'text', text: '迁移前备份' }],
      timestamp: 1_700_000_010_000,
    }],
  )
  const guarded = store.prepareConversationPiSession({
    conversationId: guardedConversation.id,
    title: guardedConversation.title,
    cwd: userDataDir,
    agentDir: path.join(userDataDir, 'pi-runtime'),
    modelProvider: 'xiaoliang-managed',
    modelId: 'qwen3.8-max',
    thinkingLevel: 'low',
  })
  guarded.sessionManager.appendMessage(assistantMessage('迁移后的新消息', 1_700_000_011_000))
  store.rebuildConversationPiProjection({
    conversationId: guardedConversation.id,
    title: guardedConversation.title,
    sessionManager: guarded.sessionManager,
  })
  assert.equal(repository.getDisplayMessageRecords(guardedConversation.id).length, 2)
  fs.unlinkSync(guarded.binding.piSessionFile)
  assert.throws(
    () => store.prepareConversationPiSession({
      conversationId: guardedConversation.id,
      title: guardedConversation.title,
      cwd: userDataDir,
      agentDir: path.join(userDataDir, 'pi-runtime'),
      modelProvider: 'xiaoliang-managed',
      modelId: 'qwen3.8-max',
      thinkingLevel: 'low',
    }),
    /避免回退到过期备份/,
  )
  const failedBinding = store.getConversationPiSessionBinding(guardedConversation.id)
  assert.equal(failedBinding.piSessionId, guarded.binding.piSessionId)
  assert.equal(failedBinding.migrationStatus, 'failed')
  assert.equal(
    repository.getDisplayMessageRecords(guardedConversation.id).length,
    2,
    'a failed binding must keep the latest SQLite projection instead of reading legacy agent_state',
  )

  const drawingProject = repository.createProject('Pi 图纸清理测试')
  const drawing = repository.createDrawing(drawingProject.id, '迁移图纸.dwg')
  const drawingConversation = repository.createConversationInDrawing(
    drawing.id,
    '图纸历史保留',
  )
  repository.persistConversationState(
    drawingConversation.id,
    drawingConversation.title,
    [{
      role: 'user',
      content: [{ type: 'text', text: `历史图纸引用 ${drawing.id}` }],
      timestamp: 1_700_000_020_000,
    }],
  )
  const drawingSession = store.prepareConversationPiSession({
    conversationId: drawingConversation.id,
    title: drawingConversation.title,
    cwd: userDataDir,
    agentDir: path.join(userDataDir, 'pi-runtime'),
    modelProvider: 'xiaoliang-managed',
    modelId: 'qwen3.8-max',
    thinkingLevel: 'low',
  })
  const drawingLegacyBackup = inspector
    .prepare('SELECT agent_state FROM conversations WHERE id = ?')
    .pluck()
    .get(drawingConversation.id)
  const drawingDeleteResult = repository.deleteDrawing(drawing.id)
  assert.ok(drawingDeleteResult.deletedConversationIds.includes(drawingConversation.id))
  assert.equal(
    inspector.prepare('SELECT agent_state FROM conversations WHERE id = ?').pluck()
      .get(drawingConversation.id),
    drawingLegacyBackup,
    'drawing cleanup must not mutate a migrated conversation backup',
  )
  assert.equal(fs.existsSync(drawingSession.binding.piSessionFile), true)
  inspector.close()
})

test('typed subagent completions project as host notices without exposing their payload', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-pi-host-notice-'))
  const repository = loadBundledModule(
    'electron/runtime/conversations/conversation-repository.ts',
    userDataDir,
  )
  const store = loadBundledModule(
    'electron/runtime/agent/pi/pi-session-store.ts',
    userDataDir,
  )
  const completion = loadBundledModule(
    'src/shared/subagent-completion.ts',
    userDataDir,
  )

  const project = repository.createProject('Pi 系统消息投影测试')
  const conversation = repository.createConversationInProject(project.id, '系统回报')
  const prepared = store.prepareConversationPiSession({
    conversationId: conversation.id,
    title: conversation.title,
    cwd: userDataDir,
    agentDir: path.join(userDataDir, 'pi-runtime'),
    modelProvider: 'xiaoliang-managed',
    modelId: 'qwen3.8-max',
    thinkingLevel: 'low',
  })
  const payload = completion.buildSubagentCompletionPrompt({
    parentPromptId: 'prompt-custom-notice-1',
    completions: [{
      taskId: 'child-custom-notice-1',
      agentType: 'blender-modeler',
      status: 'completed',
      payload: 'private child report that must stay out of the transcript',
    }],
  })
  const entryId = prepared.sessionManager.appendCustomMessageEntry(
    completion.SUBAGENT_COMPLETION_CUSTOM_TYPE,
    payload,
    false,
    {
      systemEventId: `${completion.SUBAGENT_COMPLETION_CUSTOM_TYPE}:child-custom-notice-1`,
      payload: {
        taskId: 'child-custom-notice-1',
        agentType: 'blender-modeler',
        status: 'completed',
      },
    },
  )
  prepared.sessionManager.appendMessage(
    assistantMessage('父会话已处理回报', 1_700_000_020_000),
  )

  store.rebuildConversationPiProjection({
    conversationId: conversation.id,
    title: conversation.title,
    sessionManager: prepared.sessionManager,
  })

  const projected = repository.getDisplayMessageRecords(conversation.id)
  assert.equal(projected.length, 2)
  assert.equal(projected[0].id, `pi:${prepared.binding.piSessionId}:${entryId}`)
  assert.deepEqual(projected[0].hostNotice, {
    kind: 'subagent_completion',
    taskId: 'child-custom-notice-1',
    agentType: 'blender-modeler',
    status: 'completed',
  })
  assert.match(projected[0].content, /Blender 子代理已完成/)
  assert.doesNotMatch(projected[0].content, /private child report|subagent_completion/)

  const storedEntry = prepared.sessionManager.getEntry(entryId)
  assert.equal(storedEntry.type, 'custom_message')
  assert.equal(storedEntry.display, false)
})

test('a new Xiaoliang Pi session materializes its JSONL header before any assistant turn', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-pi-new-session-'))
  const store = loadBundledModule(
    'electron/runtime/agent/pi/pi-session-store.ts',
    userDataDir,
  )
  const manager = store.createMaterializedPiSession({
    cwd: userDataDir,
    sessionDir: path.join(userDataDir, 'pi-runtime', 'sessions'),
    name: '空白新会话',
    modelProvider: 'xiaoliang-managed',
    modelId: 'qwen3.8-max',
    thinkingLevel: 'low',
  })
  const sessionFile = manager.getSessionFile()
  assert.equal(fs.existsSync(sessionFile), true)
  const header = JSON.parse(fs.readFileSync(sessionFile, 'utf8').split('\n')[0])
  assert.equal(header.type, 'session')
  assert.equal(header.id, manager.getSessionId())
  assert.equal(manager.buildSessionContext().messages.length, 0)
})

test('cold-start Pi session setup stays local and preserves legacy UI fallback', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-pi-cold-start-'))
  const managedModels = loadBundledModule(
    'electron/runtime/llm/managed-model-factory.ts',
    userDataDir,
  )
  const managerSource = fs.readFileSync(
    path.join(projectRoot, 'electron/runtime/agent/sessions/agent-session-manager.ts'),
    'utf8',
  )

  assert.throws(
    () => managedModels.buildManagedPiModel('default', 'main'),
    /托管模型能力目录尚未加载/,
    'a cold process must still require the trusted catalog before a real model call',
  )
  assert.deepEqual(managedModels.getManagedPiSessionIdentity('default'), {
    provider: 'xiaoliang-backend',
    modelId: 'xiaoliang-agent-default',
  })

  const prepareStart = managerSource.indexOf('private preparePiSessionForConversation(')
  const prepareEnd = managerSource.indexOf('\n  private initializeConversationPiSession(', prepareStart)
  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart)
  const prepareSource = managerSource.slice(prepareStart, prepareEnd)
  assert.match(prepareSource, /getManagedPiSessionIdentity\('default'\)/)
  assert.doesNotMatch(prepareSource, /buildManagedPiModel/)
  assert.match(managerSource, /private preparePiSessionForDisplay\(/)
  assert.match(managerSource, /private initializeNewConversationPiSession\(/)
})

test('XiaoliangPiAgentHost resumes a file-backed session and persists run identity', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-pi-host-session-'))
  const store = loadBundledModule(
    'electron/runtime/agent/pi/pi-session-store.ts',
    userDataDir,
  )
  const { XiaoliangPiAgentHost } = loadBundledModule(
    'electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts',
    userDataDir,
  )
  const {
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
  } = await import('@earendil-works/pi-ai')
  const faux = fauxProvider({
    provider: 'xiaoliang-stage3-host',
    tokensPerSecond: 100_000,
  })
  const model = faux.getModel()
  model.reasoning = true
  faux.setResponses([fauxAssistantMessage(fauxText('持久化回答'))])
  const sessionDir = path.join(userDataDir, 'pi-runtime', 'sessions')
  const manager = store.createMaterializedPiSession({
    cwd: userDataDir,
    sessionDir,
    name: 'Host 持久化',
    modelProvider: model.provider,
    modelId: model.id,
    thinkingLevel: 'low',
  })
  const host = await XiaoliangPiAgentHost.create({
    cwd: userDataDir,
    agentDir: path.join(userDataDir, 'pi-runtime'),
    generation: 1,
    model,
    provider: faux.provider,
    thinkingLevel: 'xhigh',
    tools: [],
    sessionManager: manager,
    systemPrompt: 'stage 3 host',
    beforePersistMessage: (message) => {
      message.clientRunId = 'run-stage3'
    },
    onEvent: () => undefined,
  })
  assert.equal(host.session.thinkingLevel, 'low')
  await host.prompt('持久化问题')
  const hostStats = host.getSessionStats()
  assert.equal(hostStats.userMessages, 1)
  assert.equal(hostStats.assistantMessages, 1)
  assert.ok((await host.listSessions()).some((session) => (
    session.id === host.session.sessionId
  )))
  const htmlExportPath = path.join(userDataDir, 'host-session.html')
  assert.equal(await host.exportToHtml(htmlExportPath), htmlExportPath)
  const htmlExport = fs.readFileSync(htmlExportPath, 'utf8')
  const encodedSessionData = htmlExport.match(
    /<script id="session-data" type="application\/json">([^<]+)<\/script>/,
  )?.[1]
  assert.ok(encodedSessionData)
  assert.match(Buffer.from(encodedSessionData, 'base64').toString('utf8'), /持久化回答/)
  const sessionFile = host.session.sessionFile
  const sessionId = host.session.sessionId
  await host.dispose()

  const persistedEntries = fs.readFileSync(sessionFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const persistedMessages = persistedEntries
    .filter((entry) => entry.type === 'message')
    .map((entry) => entry.message)
  assert.deepEqual(persistedMessages.map((message) => message.role), ['user', 'assistant'])
  assert.ok(persistedMessages.every((message) => message.clientRunId === 'run-stage3'))

  const reopenedManager = manager.constructor.open(sessionFile, sessionDir, userDataDir)
  const resumed = await XiaoliangPiAgentHost.create({
    cwd: userDataDir,
    agentDir: path.join(userDataDir, 'pi-runtime'),
    generation: 2,
    model,
    provider: faux.provider,
    thinkingLevel: 'xhigh',
    tools: [],
    sessionManager: reopenedManager,
    systemPrompt: 'stage 3 resumed host',
    onEvent: () => undefined,
  })
  try {
    assert.equal(resumed.session.sessionId, sessionId)
    assert.deepEqual(
      resumed.agent.state.messages.map((message) => message.role),
      ['user', 'assistant'],
    )
    assert.equal(resumed.session.thinkingLevel, 'low')
  } finally {
    await resumed.dispose()
  }

  const callerManager = manager.constructor.open(sessionFile, sessionDir, userDataDir)
  const callerPreferred = await XiaoliangPiAgentHost.create({
    cwd: userDataDir,
    agentDir: path.join(userDataDir, 'pi-runtime'),
    generation: 3,
    model,
    provider: faux.provider,
    thinkingLevel: 'high',
    thinkingLevelSource: 'caller',
    tools: [],
    sessionManager: callerManager,
    systemPrompt: 'stage 3 caller-preferred host',
    onEvent: () => undefined,
  })
  try {
    assert.equal(callerPreferred.session.thinkingLevel, 'high')
  } finally {
    await callerPreferred.dispose()
  }
})

test('stage 3 schema and IPC keep Pi identity and import/export contracts explicit', () => {
  const schema = fs.readFileSync(
    path.join(projectRoot, 'electron/runtime/db/schema.ts'),
    'utf8',
  )
  const contract = fs.readFileSync(
    path.join(projectRoot, 'src/shared/ipc-contract.ts'),
    'utf8',
  )
  const historyDialog = fs.readFileSync(
    path.join(projectRoot, 'src/components/chat/conversation-history-dialog.tsx'),
    'utf8',
  )
  const bridge = fs.readFileSync(
    path.join(projectRoot, 'src/services/electron-bridge.ts'),
    'utf8',
  )
  const ipcHandlers = fs.readFileSync(
    path.join(projectRoot, 'electron/runtime/ipc/ipc-handlers.ts'),
    'utf8',
  )
  assert.match(schema, /CREATE TABLE IF NOT EXISTS conversation_session_bindings/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS conversation_message_id_mappings/)
  assert.match(schema, /pi_session_id\s+TEXT/)
  assert.match(schema, /pi_entry_id\s+TEXT/)
  assert.match(contract, /AGENT_GET_SESSION_INFO: 'agent:getSessionInfo'/)
  assert.match(contract, /AGENT_EXPORT_SESSION: 'agent:exportSession'/)
  assert.match(contract, /AGENT_IMPORT_SESSION: 'agent:importSession'/)
  assert.match(bridge, /getConversationSessionInfo/)
  assert.match(bridge, /exportConversationSession/)
  assert.match(bridge, /importConversationSession/)
  assert.match(historyDialog, /导出 \{format\.toUpperCase\(\)\}/)
  assert.match(historyDialog, /确认导入/)
  for (const channel of [
    'AGENT_GET_SESSION_INFO',
    'AGENT_LIST_SESSIONS',
    'AGENT_EXPORT_SESSION',
    'AGENT_IMPORT_SESSION',
  ]) {
    assert.match(ipcHandlers, new RegExp(`removeHandler\\(IPC_INVOKE\\.${channel}\\)`))
  }
})
