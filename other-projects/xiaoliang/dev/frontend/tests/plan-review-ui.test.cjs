const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
}

test('session controls do not let the user enter plan mode', () => {
  const dock = read('src/components/chat/chat-input-dock.tsx')
  const panel = read('src/components/runtime/agent-chat-panel.tsx')
  assert.match(dock, /data-session-controls/)
  assert.doesNotMatch(dock, /data-agent-mode/)
  assert.doesNotMatch(dock, /data-view-plan/)
  assert.doesNotMatch(panel, /conversationModeControl/)
  assert.doesNotMatch(panel, /setConversationAgentMode/)
})

test('chat panel routes confirmation to A2UI tray and overlays for plan/review', () => {
  const panel = read('src/components/runtime/agent-chat-panel.tsx')
  assert.match(panel, /pendingInteraction\?\.kind === 'confirmation'/)
  assert.match(panel, /plan-approval-overlay/)
  assert.match(panel, /component-review-overlay/)
  assert.match(panel, /kind === 'plan_approval'/)
  assert.match(panel, /kind === 'component_review'/)
})

test('overlays render actions and error bucket keeps persistent cards', () => {
  const plan = read('src/components/runtime/plan-approval-overlay.tsx')
  assert.match(plan, /data-plan-approval-overlay/)
  assert.match(plan, /INTERACTION_PLAN_APPROVE_ACTION/)
  assert.match(plan, /INTERACTION_PLAN_REVISE_ACTION/)
  assert.match(plan, /INTERACTION_PLAN_ABANDON_ACTION/)
  assert.match(plan, /data-plan-empty/)

  const review = read('src/components/runtime/component-review-overlay.tsx')
  assert.match(review, /data-component-review-overlay/)
  assert.match(review, /INTERACTION_REVIEW_CONFIRM_ACTION/)
  assert.match(review, /INTERACTION_REVIEW_SKIP_ACTION/)
  assert.match(review, /将覆盖已确认构件/)

  const buckets = read('src/hooks/conversation-runtime-buckets.ts')
  assert.match(buckets, /isPersistentInteractionKind\(current\.pendingInteraction\.kind\)/)
  assert.match(buckets, /请复核本轮构件/)

  const sidebar = read('src/components/layout/workspace-sidebar.tsx')
  assert.match(sidebar, /data-conversation-needs-input/)
  assert.match(sidebar, /interaction_requested/)
})

test('IPC contract, types, bridge and handlers stay in lockstep for plan mode', () => {
  const contract = read('src/shared/ipc-contract.ts')
  const types = read('src/types/electron.d.ts')
  const bridge = read('src/services/electron-bridge.ts')
  const handlers = read('electron/runtime/ipc/ipc-handlers.ts')
  for (const channel of [
    'agent:setConversationMode',
    'agent:getPlanDocument',
    'agent:openPlanApproval',
  ]) {
    assert.match(contract, new RegExp(channel.replace(':', ':[\\s\\S]*?')))
    assert.match(types, new RegExp(channel))
    assert.match(bridge, new RegExp(channel.replace('agent:', 'AGENT_').toUpperCase() === 'x' ? channel : 'AGENT_'))
  }
  assert.match(contract, /AGENT_SET_CONVERSATION_MODE:\s*'agent:setConversationMode'/)
  assert.match(contract, /AGENT_GET_PLAN_DOCUMENT:\s*'agent:getPlanDocument'/)
  assert.match(contract, /AGENT_OPEN_PLAN_APPROVAL:\s*'agent:openPlanApproval'/)
  assert.match(types, /agent:setConversationMode/)
  assert.match(types, /agent:getPlanDocument/)
  assert.match(types, /agent:openPlanApproval/)
  assert.match(bridge, /setConversationMode\(/)
  assert.match(bridge, /getPlanDocument\(/)
  assert.match(bridge, /openPlanApproval\(/)
  assert.match(handlers, /AGENT_SET_CONVERSATION_MODE/)
  assert.match(handlers, /AGENT_GET_PLAN_DOCUMENT/)
  assert.match(handlers, /AGENT_OPEN_PLAN_APPROVAL/)
})
