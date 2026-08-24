const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const frontendRoot = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8')
}

test('workspace search crosses project, title, message, thinking, and tool fields', () => {
  const repositorySource = read('electron/runtime/conversations/conversation-repository.ts')

  assert.match(repositorySource, /export function searchWorkspace/)
  assert.match(repositorySource, /instr\(lower\(p\.name\), search\.keyword\)/)
  assert.match(repositorySource, /instr\(lower\(p\.description\), search\.keyword\)/)
  assert.match(repositorySource, /instr\(lower\(c\.title\), search\.keyword\)/)
  assert.match(repositorySource, /instr\(lower\(m\.content\), search\.keyword\)/)
  assert.match(repositorySource, /instr\(lower\(m\.thinking\), search\.keyword\)/)
  assert.match(repositorySource, /instr\(lower\(m\.tool_result\), search\.keyword\)/)
  assert.match(repositorySource, /instr\(lower\(m\.tool_args\), search\.keyword\)/)
  assert.match(repositorySource, /instr\(lower\(m\.tool_name\), search\.keyword\)/)
  assert.match(repositorySource, /ORDER BY match_rank ASC,[\s\S]*is_pinned DESC,[\s\S]*updated_at DESC/)
  assert.match(repositorySource, /workspaceSearchSnippet\(row\.matched_text, query\)/)
  assert.match(repositorySource, /Math\.floor\(requestedLimit\)/)
})

test('workspace search is wired through shared IPC and the renderer bridge', () => {
  const contractSource = read('src/shared/ipc-contract.ts')
  const handlerSource = read('electron/runtime/ipc/ipc-handlers.ts')
  const managerSource = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const bridgeSource = read('src/services/electron-bridge.ts')
  const electronTypesSource = read('src/types/electron.d.ts')

  assert.match(contractSource, /AGENT_SEARCH_WORKSPACE: 'agent:searchWorkspace'/)
  assert.match(handlerSource, /IPC_INVOKE\.AGENT_SEARCH_WORKSPACE/)
  assert.match(handlerSource, /removeHandler\(IPC_INVOKE\.AGENT_SEARCH_WORKSPACE\)/)
  assert.match(managerSource, /searchWorkspace\(input: WorkspaceSearchRequest\)/)
  assert.match(bridgeSource, /searchWorkspace\(request: WorkspaceSearchRequest\): Promise<WorkspaceSearchResult\[\]>/)
  assert.match(electronTypesSource, /channel: 'agent:searchWorkspace'/)
})

test('sidebar opens an accessible global search dialog instead of filtering inline', () => {
  const sidebarSource = read('src/components/layout/workspace-sidebar.tsx')
  const dialogSource = read('src/components/layout/workspace-search-dialog.tsx')

  assert.doesNotMatch(sidebarSource, /placeholder="搜索项目或对话"/)
  assert.match(sidebarSource, /aria-haspopup="dialog"/)
  assert.match(sidebarSource, /focus-visible:border-violet-300 focus-visible:ring-violet-100 focus-visible:ring-offset-0/)
  assert.match(sidebarSource, /electronBridge\.searchWorkspace\(\{ query: searchQuery, limit: 50 \}\)/)
  assert.match(sidebarSource, /result\.matchedMessageId \?\? undefined/)
  assert.match(dialogSource, /role="dialog"/)
  assert.match(dialogSource, /aria-modal="true"/)
  assert.match(dialogSource, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(dialogSource, /previousFocus\?\.focus\(\)/)
  assert.match(dialogSource, /event\.key === 'Escape'/)
  assert.match(dialogSource, /event\.key !== 'Tab'/)
  assert.match(dialogSource, /aria-live="polite"/)
  assert.match(dialogSource, /SEARCH_DEBOUNCE_MS = 150/)
  assert.match(dialogSource, /HighlightedText/)
})

test('message search results open the conversation and focus the matched message', () => {
  const appSource = read('src/App.tsx')
  const chatSource = read('src/components/runtime/agent-chat-panel.tsx')

  assert.match(appSource, /messageId: messageId \?\? null/)
  assert.match(chatSource, /pendingMessageFocusRef/)
  assert.match(chatSource, /getMessageElementId\(message\.id\)/)
  assert.match(chatSource, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/)
  assert.match(chatSource, /element\.focus\(\{ preventScroll: true \}\)/)
  assert.match(chatSource, /ring-2 ring-violet-300 ring-offset-2/)
  assert.match(chatSource, /SEARCH_HIGHLIGHT_DURATION_MS = 2400/)
})
