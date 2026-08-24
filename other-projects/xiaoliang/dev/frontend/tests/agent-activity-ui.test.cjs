const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
}

test('chat header does not duplicate live subagent status', () => {
  const panelSource = read('src/components/runtime/agent-chat-panel.tsx')
  const workbenchSource = read('src/components/runtime/workbench-side-panel.tsx')
  const headerStart = panelSource.indexOf('<header')
  const headerEnd = panelSource.indexOf('</header>')
  const headerSource = headerStart === -1 || headerEnd === -1 ? '' : panelSource.slice(headerStart, headerEnd)

  assert.notEqual(headerStart, -1)
  assert.doesNotMatch(headerSource, /ThinkingOrb/)
  assert.doesNotMatch(headerSource, /subagentStatusLabel/)
  assert.doesNotMatch(panelSource, /subagentStatusLabel/)
  assert.match(panelSource, /subagentRun=\{cadSubagentRun\}/)
  assert.match(panelSource, /<ThinkingOrb[\s\S]*?state="solving"[\s\S]*?size=\{20\}/)
  assert.match(panelSource, /min-w-0 flex-1 truncate" title=\{backgroundSubagentsText\}/)
  assert.match(workbenchSource, /有子代理正在运行/)
})

test('message input beam is driven only by the active response state', () => {
  const inputSource = read('src/components/chat/chat-input-dock.tsx')

  assert.match(inputSource, /import \{ BorderBeam \} from 'border-beam'/)
  assert.match(
    inputSource,
    /<BorderBeam[\s\S]*?active=\{isAgentRunning\}[\s\S]*?size="pulse-inner"[\s\S]*?colorVariant="ocean"[\s\S]*?staticColors[\s\S]*?data-chat-input-beam/,
  )
  assert.match(inputSource, /position: 'absolute'/)
  assert.match(inputSource, /pointerEvents: 'none'/)
  assert.doesNotMatch(inputSource, /active=\{true\}/)
})

test('CAD and Blender status rows share robot icons and aligned tool slots', () => {
  const indicatorSource = read('src/components/chat/cad-connection-indicator.tsx')

  assert.doesNotMatch(indicatorSource, /ShieldCheck/)
  assert.match(indicatorSource, /<Bot[\s\S]{0,900}CAD 子智能体/)
  assert.match(indicatorSource, /<Bot[\s\S]{0,900}Blender 子智能体/)
  assert.equal((indicatorSource.match(/<SubagentToolsButton/g) ?? []).length, 2)
  assert.equal((indicatorSource.match(/<SubagentStatusBadge/g) ?? []).length, 2)
  assert.match(indicatorSource, /if \(phase === 'ready'\) return '已就绪'/)
  assert.doesNotMatch(indicatorSource, /gap-1 rounded-full px-2 py-0\.5/)
  assert.match(
    indicatorSource,
    /<SubagentToolsButton\s+disabled\s+label="Blender 诊断暂不可用"/,
  )
})

test('new conversations remain available while another conversation is running', () => {
  const panelSource = read('src/components/runtime/agent-chat-panel.tsx')
  const hookSource = read('src/hooks/use-local-agent-chat.ts')

  assert.match(
    panelSource,
    /onClick=\{\(\) => void createNewConversation\(\)\}[\s\S]{0,120}disabled=\{loading\}/,
  )
  assert.match(
    hookSource,
    /async function createNewConversation\(\) \{\s+if \(loading\) return/,
  )
  assert.doesNotMatch(panelSource, /disabled=\{loading \|\| isAgentRunning\}/)
})

test('new conversation UI stays as an in-memory draft until the first send', () => {
  const panelSource = read('src/components/runtime/agent-chat-panel.tsx')
  const hookSource = read('src/hooks/use-local-agent-chat.ts')
  const projectSource = read('src/components/project/project-workspace.tsx')
  const sidebarSource = read('src/components/layout/workspace-sidebar.tsx')

  assert.doesNotMatch(panelSource, /autoCreateIfEmpty/)
  assert.match(hookSource, /draftCreationSourceRef\.current = 'desktop_new_button'/)
  assert.match(hookSource, /if \(!conversationId\) \{[\s\S]*?createScopedConversation/)
  assert.doesNotMatch(projectSource, /createConversationInProject/)
  assert.doesNotMatch(sidebarSource, /createConversationInProject/)
})

test('project conversation actions stay icon-only on the title row', () => {
  const workspaceSource = read('src/components/project/project-workspace.tsx')
  const conversationCardStart = workspaceSource.indexOf('flex items-start gap-2')
  const conversationCard = workspaceSource.slice(conversationCardStart, workspaceSource.indexOf('{editing ?', conversationCardStart))

  assert.notEqual(conversationCardStart, -1)
  assert.match(conversationCard, /更新于 \{formatUpdatedAt\(conversation\.updatedAt\)\}/)
  assert.match(conversationCard, /aria-label="重命名对话"/)
  assert.match(conversationCard, /aria-label=\{conversation\.isPinned \? '取消置顶对话' : '置顶对话'\}/)
  assert.match(conversationCard, /aria-label="删除对话"/)
  assert.doesNotMatch(conversationCard, /flex items-end gap-2/)
  assert.doesNotMatch(conversationCard, />\s*重命名\s*</)
  assert.doesNotMatch(conversationCard, />\s*删除\s*</)
})

test('project conversations refresh when the preserved workspace becomes active again', () => {
  const appSource = read('src/App.tsx')
  const workspaceSource = read('src/components/project/project-workspace.tsx')

  assert.match(appSource, /const showProjectWorkspace = !showSettings && !showChat/)
  assert.match(
    appSource,
    /<ProjectWorkspace\s+active=\{showProjectWorkspace\}/,
  )
  assert.match(
    workspaceSource,
    /useEffect\(\(\) => \{\s+if \(!active\) return[\s\S]*?\}, \[active, refreshConversations\]\)/,
  )
})

test('background children stay visible and abandonable after the main turn stops', () => {
  const panelSource = read('src/components/runtime/agent-chat-panel.tsx')
  const hookSource = read('src/hooks/use-local-agent-chat.ts')
  const bucketSource = read('src/hooks/conversation-runtime-buckets.ts')
  const bridgeSource = read('src/services/electron-bridge.ts')

  // Children outlive the parent turn, so sending the next message must not hide them.
  assert.match(
    panelSource,
    /backgroundSubagentsRunning = activeSubagentRuns\.length > 0/,
  )
  assert.match(panelSource, /backgroundSubagentsRunning \?[\s\S]{0,900}\{backgroundSubagentsText\}/)
  assert.match(bucketSource, /describeActiveSubagentRuns[\s\S]{0,400}完成后会自动汇报/)
  assert.match(panelSource, /onClick=\{\(\) => void cancelSubagents\(\)\}[\s\S]{0,400}全部停止/)

  assert.match(hookSource, /const activeSubagentRuns = subagentRuns\.filter\(isActiveSubagentRun\)/)
  assert.match(hookSource, /async function stopAgent\(scope: AgentStopScope = 'main'\)/)
  assert.match(hookSource, /electronBridge\.stopAgent\(conversationId, scope\)/)
  assert.match(hookSource, /async function cancelSubagents\(\)[\s\S]{0,600}cancelAgentSubagents\(conversationId\)/)
  assert.match(bridgeSource, /scope: AgentStopScope = 'main'[\s\S]{0,300}IPC_INVOKE\.AGENT_STOP, conversationId, scope/)
})

test('the running input dock tells the user an interjection will be picked up promptly', () => {
  const inputSource = read('src/components/chat/chat-input-dock.tsx')

  assert.match(inputSource, /'继续输入：Enter 排队到下一轮，可在队列中改为立即引导'/)
  assert.doesNotMatch(inputSource, /title="Enter 排队到下一轮；可在队列中改为立即引导"/)
  // Queue preview and withdrawal keep working unchanged under the new stop semantics.
  assert.match(inputSource, /onClearQueue/)
})

test('animation packages are declared as application dependencies', () => {
  const packageJson = JSON.parse(read('package.json'))

  assert.equal(packageJson.dependencies['thinking-orbs'], '^0.2.0')
  assert.equal(packageJson.dependencies['border-beam'], '^1.3.0')
})
