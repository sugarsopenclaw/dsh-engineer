const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

test('prompt templates support account CRUD, insertion, and lifecycle refresh without a capability panel', () => {
  const dialog = read('src/components/chat/prompt-template-dialog.tsx')
  const input = read('src/components/chat/chat-input-dock.tsx')
  const resourceHook = read('src/hooks/use-session-runtime-resources.ts')
  const userHook = read('src/hooks/use-user-prompt-templates.ts')
  const host = read('electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts')
  const contract = read('src/shared/ipc-contract.ts')
  const types = read('src/types/electron.d.ts')
  const bridge = read('src/services/electron-bridge.ts')
  const handlers = read('electron/runtime/ipc/ipc-handlers.ts')
  const client = read('electron/runtime/backend/prompt-template-client.ts')

  assert.match(dialog, /提示词模板/)
  assert.match(dialog, /新建模板/)
  assert.match(dialog, /保存修改/)
  assert.match(dialog, /删除模板/)
  assert.match(dialog, /创建常用提示词，点击即可插入当前输入框。/)
  assert.doesNotMatch(dialog, /私有 OSS|自动获取最新内容|按账号保存/)
  assert.match(dialog, /data-user-prompt-templates/)
  assert.match(dialog, /data-runtime-prompt-templates/)
  assert.match(dialog, /onInsertTemplate\(content\)/)
  assert.doesNotMatch(dialog, /会话能力|重新加载技能与模板|运行行为|自动上下文压缩|自动重试|toolSourceLabel|resources\?\.skills|resources\?\.tools/)

  assert.match(host, /argumentHint: prompt\.argumentHint/)
  assert.match(resourceHook, /resourceCache/)
  assert.doesNotMatch(resourceHook, /reloadConversationRuntimeResources|['"]reload['"]/)
  assert.match(userHook, /useAuthStore/)
  assert.match(userHook, /templateCache = new Map<string/)
  assert.match(userHook, /listPromptTemplates\(\)/)
  assert.match(userHook, /createPromptTemplate\(payload\)/)
  assert.match(userHook, /updatePromptTemplate\(templateId, payload\)/)
  assert.match(userHook, /deletePromptTemplate\(templateId\)/)
  assert.match(userHook, /window\.addEventListener\('focus'/)
  assert.match(userHook, /document\.addEventListener\('visibilitychange'/)

  assert.match(input, /PromptTemplateDialog/)
  assert.match(input, /data-template-autocomplete/)
  assert.match(input, /\^\\\/\(\[\^\\s\]\*\)\$\/u/)
  assert.match(input, /event\.key === 'ArrowDown'/)
  assert.match(input, /event\.key === 'ArrowUp'/)
  assert.match(input, /event\.key === 'Escape'/)
  assert.match(input, /template\.argumentHint/)
  assert.match(input, /source: 'user'/)
  assert.match(input, /template\.content/)
  assert.match(input, /role="combobox"/)
  assert.match(input, /role="listbox"/)

  for (const channel of [
    'promptTemplate:list',
    'promptTemplate:create',
    'promptTemplate:update',
    'promptTemplate:delete',
  ]) {
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(contract, new RegExp(escaped))
    assert.match(types, new RegExp(escaped))
  }
  assert.match(bridge, /listPromptTemplates/)
  assert.match(bridge, /createPromptTemplate/)
  assert.match(bridge, /updatePromptTemplate/)
  assert.match(bridge, /deletePromptTemplate/)
  assert.match(handlers, /promptTemplateApiClient\.list/)
  assert.match(handlers, /promptTemplateApiClient\.create/)
  assert.match(handlers, /promptTemplateApiClient\.update/)
  assert.match(handlers, /promptTemplateApiClient\.delete/)
  assert.match(client, /\/users\/me\/prompt-templates/)
})

test('automatic recovery defaults, focused compaction, and granular cancellation cross the intended boundary', () => {
  const contract = read('src/shared/ipc-contract.ts')
  const types = read('src/types/electron.d.ts')
  const bridge = read('src/services/electron-bridge.ts')
  const handlers = read('electron/runtime/ipc/ipc-handlers.ts')
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const host = read('electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts')
  const ring = read('src/components/chat/context-usage-ring.tsx')
  const panel = read('src/components/runtime/agent-chat-panel.tsx')
  const tree = read('src/components/chat/conversation-tree-dialog.tsx')

  for (const channel of [
    'agent:abortCompaction',
    'agent:abortBranchSummary',
    'agent:abortRetry',
  ]) {
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(contract, new RegExp(escaped))
    assert.match(types, new RegExp(escaped))
  }

  for (const removed of [
    'agent:getRuntimeBehavior',
    'agent:setRuntimeBehavior',
    'agent:reloadRuntimeResources',
  ]) {
    assert.doesNotMatch(contract, new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(types, new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(bridge, /RuntimeBehavior|reloadConversationRuntimeResources/)
  assert.doesNotMatch(handlers, /parseRuntimeBehaviorUpdate/)
  assert.doesNotMatch(manager, /getConversationPiRuntimeBehavior|setConversationPiRuntimeBehavior|reloadConversationPiResources/)
  assert.doesNotMatch(host, /getRuntimeBehaviorStatus|assertConfigurable|setAutoCompactionEnabled\(enabled|setAutoRetryEnabled\(enabled/)
  assert.match(host, /setAutoCompactionEnabled\(true\)/)
  assert.match(host, /setAutoRetryEnabled\(true\)/)

  assert.match(types, /instructions\?: string/)
  assert.match(handlers, /compactConversation\([\s\S]*instructions/)
  assert.match(manager, /session\.piHost\.compact\(instructions\?\.trim\(\) \|\| undefined\)/)
  assert.match(manager, /isCompactionCancelledError/)
  assert.match(ring, /希望保留的重点/)
  assert.match(ring, /createPortal/)
  assert.match(ring, /fixed z-\[100\]/)
  assert.match(ring, /onCompact\?\.\(normalized \|\| undefined\)/)

  assert.match(panel, /abortCompaction/)
  assert.match(panel, /abortRetry/)
  assert.match(panel, /取消本次上下文压缩/)
  assert.match(panel, /取消本次重试/)
  assert.match(tree, /onAbortSummary/)
  assert.match(panel, /abortAgentBranchSummary/)
  assert.doesNotMatch(panel, /onAbortSummary=\{async[\s\S]{0,120}stopAgent/)
})

test('desktop thinking toggle stays usable on a draft conversation and is not clipped', () => {
  const dock = read('src/components/chat/chat-input-dock.tsx')
  const panel = read('src/components/runtime/agent-chat-panel.tsx')
  const hook = read('src/hooks/use-local-agent-chat.ts')

  assert.match(dock, /createPortal/)
  assert.match(dock, /data-thinking-picker/)
  assert.match(dock, /new ResizeObserver\(updatePosition\)/)
  assert.match(dock, /top: thinkingPickerPosition\?\.top/)
  assert.match(dock, /title="极速：轻量推理；专家：最强推理"/)
  assert.doesNotMatch(panel, /disabled: loading \|\| !currentConversation \|\| isAgentRunning/)
  assert.match(panel, /disabled: loading,/)
  assert.match(hook, /draftThinkingModeRef/)
  assert.match(hook, /conversationThinkingMode/)
  assert.match(
    hook,
    /createScopedConversation\(\s*undefined,\s*draftCreationSourceRef\.current,\s*draftThinkingModeRef\.current,\s*\)/,
  )
  assert.doesNotMatch(hook, /setConversationThinkingMode\(created\.id/)
  assert.match(hook, /result\.appliedAt === 'next_turn'/)
  assert.match(hook, /当前回合结束后生效/)
})

test('opening an idle Pi session applies the desktop preference, while a live host remains the sole writer', () => {
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const prepareStart = manager.indexOf('private preparePiSessionForConversation')
  const prepareEnd = manager.indexOf('private initializeConversationPiSession', prepareStart)
  assert.ok(prepareStart >= 0)
  assert.ok(prepareEnd > prepareStart)
  const prepare = manager.slice(prepareStart, prepareEnd)

  const liveOwnerGuard = prepare.indexOf('const liveRecord = this.sessions.get(conversation.id)')
  const idlePreparation = prepare.indexOf('const prepared = prepareConversationPiSession({')
  assert.ok(liveOwnerGuard >= 0)
  assert.ok(idlePreparation > liveOwnerGuard)
  assert.match(prepare, /sessionManager: liveHost\.session\.sessionManager/)
  assert.match(prepare, /effectiveThinkingMode: liveRecord\.thinkingModeRef\.current/)
  assert.match(prepare, /appendThinkingLevelChange\(/)
  assert.match(prepare, /const desiredLevel = piThinkingLevelForMode\(configuredThinkingMode\)/)
  assert.match(prepare, /buildSessionContext\(\)\.thinkingLevel !== desiredLevel/)
  assert.match(prepare, /effectiveThinkingMode: configuredThinkingMode/)
  assert.doesNotMatch(prepare, /hasThinkingEntry|thinkingModeFromPiLevel/)
  assert.doesNotMatch(
    prepare,
    /persistConversationThinkingMode\(conversation\.id, effectiveThinkingMode\)/,
  )
})

test('thinking-mode application keeps the Pi host fingerprint and dynamic consumers in sync', () => {
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const applyStart = manager.indexOf('private applyThinkingModeToRecord(')
  const applyEnd = manager.indexOf('private applyPendingThinkingMode(', applyStart)
  assert.ok(applyStart >= 0)
  assert.ok(applyEnd > applyStart)
  const apply = manager.slice(applyStart, applyEnd)

  assert.match(apply, /record\.thinkingModeRef\.current = mode/)
  assert.match(
    apply,
    /record\.fingerprint = record\.fingerprintsByThinkingMode\[mode\]/,
  )
  assert.match(apply, /host\.session\.setThinkingLevel\(piThinkingLevelForMode\(mode\)\)/)
  assert.match(apply, /delete record\.pendingThinkingMode/)
  assert.match(manager, /const createFingerprint = \(mode: ThinkingMode\) =>/)
  assert.match(manager, /const fingerprintsByThinkingMode: Record<ThinkingMode, string> =/)
  assert.match(manager, /fingerprintsByThinkingMode,\s*thinkingModeRef,\s*tools: agentTools,/)
  assert.match(
    manager,
    /patchManagedThinkingPayload\(payload, currentModel, thinkingModeRef\.current\)/,
  )
  assert.match(manager, /thinkingMode: thinkingModeRef\.current/)
})

test('running thinking-mode changes commit at the agent-run boundary with a prompt-finally fallback', () => {
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const setterStart = manager.indexOf('setConversationThinkingMode(')
  const setterEnd = manager.indexOf('private consumeAlgorithmSaveApproval', setterStart)
  assert.ok(setterStart >= 0)
  assert.ok(setterEnd > setterStart)
  const setter = manager.slice(setterStart, setterEnd)

  assert.match(setter, /this\.activePromptConversations\.has\(conversationId\)/)
  assert.match(setter, /this\.pendingThinkingModes\.set\(conversationId, normalizedMode\)/)
  assert.match(setter, /runningRecord\.pendingThinkingMode = normalizedMode/)
  assert.match(setter, /return \{ appliedAt: 'next_turn' \}/)
  assert.match(setter, /this\.applyThinkingModeToRecord\(runningRecord, runningHost, normalizedMode\)/)
  assert.doesNotMatch(setter, /runningRecord\.thinkingModeRef\.current = normalizedMode/)
  assert.match(
    manager,
    /if \(payload\.type === 'agent_settled'\) \{\s*this\.applyPendingThinkingMode\(conversationId\)/,
  )
  assert.doesNotMatch(
    manager,
    /if \(payload\.type === 'turn_end'\) \{\s*this\.applyPendingThinkingMode\(conversationId\)/,
  )
  assert.doesNotMatch(
    manager,
    /if \(payload\.type === 'agent_end'\) \{\s*this\.applyPendingThinkingMode\(conversationId\)/,
  )
  assert.match(
    manager,
    /private finishActivePrompt\([\s\S]*?this\.applyPendingThinkingMode\(conversationId\)[\s\S]*?this\.activePromptConversations\.delete\(conversationId\)/,
  )
  assert.match(
    manager,
    /this\.activePromptThinkingModes\.set\([\s\S]*?getConversationThinkingMode\(conversationId\)/,
  )
  assert.match(
    manager,
    /this\.preparePiSessionForConversation\(\s*conversation,\s*activeThinkingMode,\s*\)/,
  )
})

test('live Pi read paths do not rebuild or retire the host while a thinking change is pending', () => {
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const resourceStart = manager.indexOf('async getConversationPiResourceStatus(')
  const resourceEnd = manager.indexOf('async reloadActivePiResources(', resourceStart)
  const resourceMethods = manager.slice(resourceStart, resourceEnd)
  const sessionStart = manager.indexOf('private async getOrCreateSession(')
  const sessionEnd = manager.indexOf('private updateSystemPrompt(', sessionStart)
  const sessionFactory = manager.slice(sessionStart, sessionEnd)

  assert.match(resourceMethods, /const liveRecord = this\.sessions\.get\(conversationId\)/)
  assert.match(resourceMethods, /liveHost\.isBusy/)
  assert.match(resourceMethods, /this\.activePromptConversations\.has\(conversationId\)/)
  assert.match(resourceMethods, /return liveHost\.getResourceStatus\(\)/)
  assert.match(sessionFactory, /const liveSession = this\.sessions\.get\(conversationId\)/)
  assert.match(
    sessionFactory,
    /let thinkingMode = liveSession\?\.piHost\s*\? liveSession\.thinkingModeRef\.current/,
  )
  assert.match(sessionFactory, /thinkingMode = existing\.thinkingModeRef\.current/)
  assert.match(sessionFactory, /fingerprint = fingerprintsByThinkingMode\[thinkingMode\]/)
})
