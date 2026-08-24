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

function userMessage(text, timestamp) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp,
  }
}

function assistantMessage(content, timestamp) {
  return {
    role: 'assistant',
    content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
    api: 'openai-completions',
    provider: 'xiaoliang-managed',
    model: 'qwen3.8-max',
    stopReason: 'stop',
    usage: {
      input: 20,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 25,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp,
  }
}

function toolResult(toolCallId, toolName, text, timestamp) {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text }],
    isError: false,
    timestamp,
  }
}

test('stage 5 projects the full Tree and forks/clones into a linked conversation family', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-pi-stage5-tree-'))
  const repository = loadBundledModule(
    'electron/runtime/conversations/conversation-repository.ts',
    userDataDir,
  )
  const store = loadBundledModule(
    'electron/runtime/agent/pi/pi-session-store.ts',
    userDataDir,
  )
  const agentDir = path.join(userDataDir, 'pi-runtime')
  const project = repository.createProject('Tree 分支测试')
  const parentConversation = repository.createConversationInProject(project.id, 'Tree 主会话')
  const prepared = store.prepareConversationPiSession({
    conversationId: parentConversation.id,
    title: parentConversation.title,
    cwd: userDataDir,
    agentDir,
    modelProvider: 'xiaoliang-managed',
    modelId: 'qwen3.8-max',
    thinkingLevel: 'low',
  })
  const manager = prepared.sessionManager
  const firstUserId = manager.appendMessage(userMessage('读取两份材料', 1_700_100_000_000))
  const toolAssistantId = manager.appendMessage(assistantMessage([
    { type: 'text', text: '我来读取。' },
    { type: 'toolCall', id: 'call-read-1', name: 'read', arguments: { path: 'a.md' } },
    { type: 'toolCall', id: 'call-read-2', name: 'read', arguments: { path: 'b.md' } },
  ], 1_700_100_001_000))
  const firstToolResultId = manager.appendMessage(
    toolResult('call-read-1', 'read', 'A 内容', 1_700_100_002_000),
  )
  const secondToolResultId = manager.appendMessage(
    toolResult('call-read-2', 'read', 'B 内容', 1_700_100_003_000),
  )
  const finalAssistantId = manager.appendMessage(
    assistantMessage('两份材料已读取。', 1_700_100_004_000),
  )
  const secondUserId = manager.appendMessage(userMessage('继续核对差异', 1_700_100_005_000))
  manager.appendMessage(assistantMessage('差异如下。', 1_700_100_006_000))

  manager.branch(toolAssistantId)
  const alternateUserId = manager.appendMessage(userMessage('改为只读 A', 1_700_100_007_000))
  manager.appendMessage(assistantMessage('只读取 A。', 1_700_100_008_000))
  manager.appendLabelChange(alternateUserId, '备选路径')

  const tree = store.buildConversationPiTreeSnapshot({
    conversationId: parentConversation.id,
    sessionManager: manager,
  })
  assert.equal(tree.cloudSyncScope, 'active_path')
  assert.ok(tree.nodes.some((node) => node.id === secondUserId && !node.isActivePath))
  assert.ok(tree.nodes.some((node) => node.id === alternateUserId && node.isActivePath))
  assert.equal(tree.nodes.find((node) => node.id === alternateUserId).label, '备选路径')
  assert.equal(tree.nodes.find((node) => node.id === toolAssistantId).cloneToolResultCount, 2)
  assert.equal(tree.nodes.find((node) => node.id === toolAssistantId).forkedChildCount, 0)
  assert.equal(tree.nodes.filter((node) => node.isLeaf).length, 1)
  const treeWithFamily = store.buildConversationPiTreeSnapshot({
    conversationId: parentConversation.id,
    sessionManager: manager,
    forkedChildCounts: new Map([[toolAssistantId, 2]]),
  })
  assert.equal(treeWithFamily.nodes.find((node) => node.id === toolAssistantId).forkedChildCount, 2)

  const clone = store.createConversationPiBranch({
    sourceSessionFile: prepared.binding.piSessionFile,
    targetEntryId: toolAssistantId,
    mode: 'clone_at',
    cwd: userDataDir,
    agentDir,
    title: 'Tree 主会话 · 克隆',
    modelProvider: 'xiaoliang-managed',
    modelId: 'qwen3.8-max',
    thinkingLevel: 'low',
  })
  assert.equal(clone.clonedThroughEntryId, secondToolResultId)
  assert.equal(clone.clonedToolResultCount, 2)
  assert.deepEqual(
    clone.sessionManager.getEntries()
      .filter((entry) => entry.type === 'message')
      .map((entry) => entry.message.role),
    ['user', 'assistant', 'toolResult', 'toolResult'],
  )
  assert.equal(
    clone.sessionManager.getHeader().parentSession,
    prepared.binding.piSessionFile,
  )

  const childConversation = repository.createConversationBranch(
    parentConversation.id,
    'Tree 主会话 · 克隆',
  )
  store.commitConversationPiSession({
    conversationId: childConversation.id,
    title: childConversation.title,
    sessionManager: clone.sessionManager,
    clearMessageMappings: true,
    parentConversationId: parentConversation.id,
    forkedFromEntryId: toolAssistantId,
  })
  const refreshedParent = repository.getConversationSummary(parentConversation.id)
  const refreshedChild = repository.getConversationSummary(childConversation.id)
  assert.equal(refreshedParent.childConversationCount, 1)
  assert.equal(refreshedParent.sessionSyncScope, 'active_path')
  assert.equal(refreshedChild.creationSource, 'desktop_tree_branch')
  assert.equal(refreshedChild.projectId, refreshedParent.projectId)
  assert.equal(refreshedChild.parentConversationId, parentConversation.id)
  assert.equal(refreshedChild.forkedFromEntryId, toolAssistantId)
  assert.equal(refreshedChild.sessionSyncScope, 'active_path')

  const archiveDb = new Database(path.join(userDataDir, 'xiaoliang-local-agent.db'))
  try {
    archiveDb.prepare(
      `UPDATE conversation_session_bindings
          SET upload_status = 'uploaded',
              archive_sha256 = ?,
              remote_storage_key = 'pi/session.jsonl',
              uploaded_at = datetime('now','localtime')
        WHERE conversation_id = ?`,
    ).run('a'.repeat(64), childConversation.id)
    const beforeArchiveChange = archiveDb.prepare(
      `SELECT archive_generation FROM conversation_session_bindings WHERE conversation_id = ?`,
    ).get(childConversation.id)

    clone.sessionManager.appendLabelChange(toolAssistantId, '归档变更')
    store.rebuildConversationPiProjection({
      conversationId: childConversation.id,
      title: childConversation.title,
      sessionManager: clone.sessionManager,
    })
    const afterArchiveChange = archiveDb.prepare(
      `SELECT archive_generation, archive_sha256, upload_status,
              remote_storage_key, uploaded_at
         FROM conversation_session_bindings
        WHERE conversation_id = ?`,
    ).get(childConversation.id)
    assert.equal(afterArchiveChange.archive_generation, beforeArchiveChange.archive_generation + 1)
    assert.equal(afterArchiveChange.archive_sha256, null)
    assert.equal(afterArchiveChange.upload_status, 'pending')
    assert.equal(afterArchiveChange.remote_storage_key, null)
    assert.equal(afterArchiveChange.uploaded_at, null)
  } finally {
    archiveDb.close()
  }

  const fork = store.createConversationPiBranch({
    sourceSessionFile: prepared.binding.piSessionFile,
    targetEntryId: secondUserId,
    mode: 'fork_before',
    cwd: userDataDir,
    agentDir,
    title: 'Tree 主会话 · 分叉',
    modelProvider: 'xiaoliang-managed',
    modelId: 'qwen3.8-max',
    thinkingLevel: 'low',
  })
  assert.equal(fork.selectedText, '继续核对差异')
  assert.equal(
    fork.sessionManager.getEntries().some((entry) => entry.id === secondUserId),
    false,
  )
  assert.ok(fork.sessionManager.getEntries().some((entry) => entry.id === finalAssistantId))
  assert.ok(fork.sessionManager.getEntries().some((entry) => entry.id === firstToolResultId))
  assert.ok(fork.sessionManager.getEntries().some((entry) => entry.id === firstUserId))
})

test('a Tree navigation marker persists the selected active path across reopen', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-pi-stage5-navigate-'))
  const store = loadBundledModule(
    'electron/runtime/agent/pi/pi-session-store.ts',
    userDataDir,
  )
  const sessionDir = path.join(userDataDir, 'pi-runtime', 'sessions')
  const manager = store.createMaterializedPiSession({
    cwd: userDataDir,
    sessionDir,
    name: 'Navigate persistence',
    modelProvider: 'xiaoliang-managed',
    modelId: 'qwen3.8-max',
    thinkingLevel: 'low',
  })
  manager.appendMessage(userMessage('原问题', 1_700_200_000_000))
  const originalAssistantId = manager.appendMessage(
    assistantMessage('原回答', 1_700_200_001_000),
  )
  manager.appendMessage(userMessage('原路径后续', 1_700_200_002_000))
  manager.appendMessage(assistantMessage('旧叶子', 1_700_200_003_000))
  manager.branch(originalAssistantId)
  const markerId = store.appendPiActivePathMarker(manager, originalAssistantId)

  const { SessionManager } = await import('@earendil-works/pi-coding-agent')
  const reopened = SessionManager.open(
    manager.getSessionFile(),
    sessionDir,
    userDataDir,
  )
  assert.equal(reopened.getLeafId(), markerId)
  assert.deepEqual(
    reopened.buildSessionContext().messages.map((message) => message.content[0]?.text),
    ['原问题', '原回答'],
  )
  const tree = store.buildConversationPiTreeSnapshot({
    conversationId: 'conversation-navigate',
    sessionManager: reopened,
  })
  assert.ok(tree.nodes.find((node) => node.id === markerId).isLeaf)
  assert.ok(tree.nodes.find((node) => node.id === originalAssistantId).isActivePath)
})

test('Tree navigation can create a retry-aware branch summary through the compaction gateway', async () => {
  const { fauxAssistantMessage, fauxProvider, fauxText } = await import('@earendil-works/pi-ai')
  const { SessionManager } = await import('@earendil-works/pi-coding-agent')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-pi-stage5-summary-'))
  const { XiaoliangPiAgentHost } = loadBundledModule(
    'electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts',
    userDataDir,
  )
  const faux = fauxProvider({
    provider: 'xiaoliang-stage5-branch-summary',
    tokensPerSecond: 100_000,
  })
  const payloads = []
  faux.setResponses([
    async (_context, options, _state, model) => {
      payloads.push(await options.onPayload({ request: 'branch-summary' }, model))
      return fauxAssistantMessage(fauxText('abandoned branch checkpoint'))
    },
  ])

  const manager = SessionManager.create(userDataDir, path.join(userDataDir, 'sessions'))
  const firstUserId = manager.appendMessage(userMessage('first question', 1_700_300_000_000))
  const targetAssistant = fauxAssistantMessage(fauxText('first answer'), {
    timestamp: 1_700_300_001_000,
  })
  targetAssistant.usage = {
    input: 20,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 25,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
  const targetAssistantId = manager.appendMessage(targetAssistant)
  manager.appendMessage(userMessage('abandoned follow-up', 1_700_300_002_000))
  const abandonedAssistant = fauxAssistantMessage(fauxText('abandoned answer'), {
    timestamp: 1_700_300_003_000,
  })
  abandonedAssistant.usage = targetAssistant.usage
  manager.appendMessage(abandonedAssistant)

  const events = []
  const host = await XiaoliangPiAgentHost.create({
    cwd: userDataDir,
    agentDir: path.join(userDataDir, 'agent'),
    generation: 1,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [],
    sessionManager: manager,
    systemPrompt: 'branch summary test',
    transformPayload: (payload) => ({ ...payload, transformedByApp: true }),
    onEvent: ({ event }) => events.push(event),
  })
  host.session.settingsManager.applyOverrides({
    retry: {
      enabled: true,
      maxRetries: 2,
      baseDelayMs: 1,
      provider: { maxRetries: 0 },
    },
  })

  try {
    const result = await host.navigateTree(targetAssistantId, { summarize: true })
    assert.equal(result.cancelled, false)
    assert.equal(result.summaryEntry.type, 'branch_summary')
    assert.match(result.summaryEntry.summary, /abandoned branch checkpoint/)
    assert.ok(result.summaryEntry.usage)
    assert.equal(manager.getLeafId(), result.summaryEntry.id)
    assert.deepEqual(payloads, [{
      request: 'branch-summary',
      transformedByApp: true,
      xiaoliang_call_purpose: 'compaction',
    }])
    assert.deepEqual(
      host.agent.state.messages.map((message) => message.role),
      ['user', 'assistant', 'branchSummary'],
    )
    assert.ok(manager.getEntries().some((entry) => entry.id === firstUserId))
    assert.equal(events.some((event) => event.type === 'agent_start'), false)
  } finally {
    await host.dispose()
  }
})

test('stage 5 exposes Tree, fork, clone, labels, family UI, and active-path archive contracts', () => {
  const contract = fs.readFileSync(path.join(projectRoot, 'src/shared/ipc-contract.ts'), 'utf8')
  const manager = fs.readFileSync(
    path.join(projectRoot, 'electron/runtime/agent/sessions/agent-session-manager.ts'),
    'utf8',
  )
  const dialog = fs.readFileSync(
    path.join(projectRoot, 'src/components/chat/conversation-tree-dialog.tsx'),
    'utf8',
  )
  const panel = fs.readFileSync(
    path.join(projectRoot, 'src/components/runtime/agent-chat-panel.tsx'),
    'utf8',
  )
  const bubble = fs.readFileSync(
    path.join(projectRoot, 'src/components/chat/message-bubble.tsx'),
    'utf8',
  )
  const inputDock = fs.readFileSync(
    path.join(projectRoot, 'src/components/chat/chat-input-dock.tsx'),
    'utf8',
  )
  const archive = fs.readFileSync(
    path.join(projectRoot, 'electron/runtime/project-sync/project-archive-sync-service.ts'),
    'utf8',
  )

  assert.match(contract, /AGENT_GET_SESSION_TREE: 'agent:getSessionTree'/)
  assert.match(contract, /AGENT_NAVIGATE_SESSION_TREE: 'agent:navigateSessionTree'/)
  assert.match(contract, /AGENT_FORK_CONVERSATION: 'agent:forkConversation'/)
  assert.match(contract, /AGENT_CLONE_CONVERSATION: 'agent:cloneConversation'/)
  assert.match(contract, /AGENT_SET_SESSION_ENTRY_LABEL: 'agent:setSessionEntryLabel'/)
  assert.match(manager, /parentConversationId: normalizedConversationId/)
  assert.match(manager, /appendPiActivePathMarker/)
  assert.match(dialog, /role="dialog"/)
  assert.match(dialog, /aria-modal="true"/)
  assert.match(dialog, /aria-live="polite"/)
  assert.match(dialog, /会话分支/)
  assert.match(dialog, /还没有分支记录/)
  assert.doesNotMatch(dialog, /DEFAULT_TREE_GRANULARITY|分支颗粒度/)
  assert.doesNotMatch(dialog, /完整历史保存在本地 JSONL/)
  assert.doesNotMatch(dialog, /云端当前仅同步活动路径/)
  assert.match(bubble, /message\.piEntryId && onForkBefore/)
  assert.match(bubble, /aria-label="编辑并分叉"/)
  assert.doesNotMatch(bubble, />\s*编辑并分叉\s*</)
  assert.match(bubble, /aria-label=\{copied \? '已复制消息' : '复制消息'\}/)
  assert.match(bubble, /showUserActions/)
  assert.doesNotMatch(bubble, /pointer-events-none absolute right-1 top-full/)
  assert.match(bubble, /aria-label="从此处分支"/)
  assert.match(panel, /electronBridge\.forkConversationBefore/)
  assert.match(panel, /electronBridge\.cloneConversationAt/)
  assert.doesNotMatch(panel, />\s*Tree\s*</)
  assert.match(inputDock, /data-conversation-branch-control/)
  assert.match(panel, /\?[\s\S]{0,80}`分支自 \$\{parentConversationTitle \|\| '原会话'\}`/)
  assert.match(panel, /: '主线'/)
  assert.match(archive, /session_sync_scope: conversation\.sessionSyncScope/)
  assert.match(archive, /parent_conversation_id: conversation\.parentConversationId/)
})
