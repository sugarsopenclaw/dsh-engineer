const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
}

function loadBundledModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    tsconfig: path.resolve(__dirname, '..', 'tsconfig.app.json'),
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    write: false,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

test('every completed assistant message exposes accessible feedback controls', () => {
  const { AgentMessageFeedback } = loadBundledModule(
    'src/components/chat/agent-message-feedback.tsx',
  )
  const markup = renderToStaticMarkup(React.createElement(AgentMessageFeedback, {
    message: {
      id: 'agent-message-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      content: '回答',
      toolName: '',
      toolArgs: '',
      toolResult: '',
      thinking: '',
      createdAt: '2026-08-11T00:00:00Z',
    },
    feedback: {
      id: 'feedback-1',
      local_conversation_id: 'conversation-1',
      local_message_id: 'agent-message-1',
      client_run_id: 'run-1',
      vote: 'up',
      outcome: null,
      issue_codes: [],
      comment: null,
      app_version: '0.8.12',
      feedback_schema_version: 1,
      created_at: '2026-08-11T00:00:00Z',
      updated_at: '2026-08-11T00:00:00Z',
    },
    onSave: async () => {},
    onDelete: async () => {},
  }))

  assert.match(markup, /aria-label="这条回答有帮助"/)
  assert.match(markup, /aria-label="这条回答需要改进"/)
  assert.match(markup, /aria-pressed="true"/)
  assert.match(markup, /aria-haspopup="dialog"/)
  assert.match(markup, /aria-controls="agent-feedback-panel-agent-message-1"/)
  assert.match(markup, /aria-label="查看或修改反馈"/)
  assert.doesNotMatch(markup, />补充意见</)
})

test('feedback details open in a modal card after a vote is saved successfully', () => {
  const source = read('src/components/chat/agent-message-feedback.tsx')

  assert.match(source, /<dialog/)
  assert.match(source, /dialog\.showModal\(\)/)
  assert.match(source, /aria-labelledby=\{panelTitleId\}/)
  assert.match(source, /aria-describedby=\{panelDescriptionId\}/)
  assert.match(source, /const saveSucceeded = await persist\(nextDraft\)/)
  assert.match(source, /if \(saveSucceeded\) setExpanded\(true\)/)
  assert.doesNotMatch(source, /if \(vote === 'down'\) setExpanded\(true\)/)
})

test('feedback is attached only after assistant bubbles, not user or tool rows', () => {
  const bubbleSource = read('src/components/chat/message-bubble.tsx')

  assert.match(bubbleSource, /if \(isTool\) \{[\s\S]*?return \(/)
  assert.match(
    bubbleSource,
    /<\/article>[\s\S]*?!isUser \? \([\s\S]*?<AgentMessageFeedback/,
  )
  assert.match(bubbleSource, /leadingControls/)
  assert.match(bubbleSource, /aria-label=\{copied \? '已复制回答' : '复制回答'\}/)
  assert.match(bubbleSource, /aria-label=\{copied \? '已复制消息' : '复制消息'\}/)
  assert.match(bubbleSource, /aria-label="从此处分支"/)
  assert.doesNotMatch(bubbleSource, />\s*从此处分支\s*</)
})

test('feedback loads once per conversation and is indexed by stable message id', () => {
  const hookSource = read('src/hooks/use-agent-message-feedback.ts')

  assert.match(
    hookSource,
    /electronBridge\.listAgentMessageFeedback\(conversationId\)/,
  )
  assert.match(hookSource, /items\.map\(\(item\) => \[item\.local_message_id, item\]\)/)
  assert.match(hookSource, /\}, \[conversationId, reloadGeneration\]\)/)
  assert.match(hookSource, /client_run_id: message\.clientRunId \?\? null/)
  assert.match(hookSource, /setLoadError\(message\)/)
  assert.match(hookSource, /writeRevisionByMessageRef\.current\.get\(writeKey\) === revision/)
})

test('feedback load failures are visible and block accidental full-state overwrite', () => {
  const panelSource = read('src/components/runtime/agent-chat-panel.tsx')
  const componentSource = read('src/components/chat/agent-message-feedback.tsx')

  assert.match(panelSource, /反馈加载失败。为避免覆盖已保存的意见，反馈入口已暂停。/)
  assert.match(panelSource, /onClick=\{retryFeedbackLoad\}/)
  assert.match(panelSource, /feedbackUnavailable=\{Boolean\(feedbackLoadError\)\}/)
  assert.match(componentSource, /const controlsDisabled = loading \|\| unavailable/)
  assert.match(componentSource, /mutationGenerationRef\.current !== mutationGeneration/)
})

test('feedback writes for the same message are sent to the backend in click order', async () => {
  const { KeyedSerialTaskQueue } = loadBundledModule(
    'src/hooks/keyed-serial-task-queue.ts',
  )
  const queue = new KeyedSerialTaskQueue()
  const events = []
  let releaseFirst
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve
  })

  const first = queue.enqueue('conversation-1/message-1', async () => {
    events.push('up:start')
    await firstGate
    events.push('up:end')
  })
  const second = queue.enqueue('conversation-1/message-1', async () => {
    events.push('down:start')
    events.push('down:end')
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['up:start'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ['up:start', 'up:end', 'down:start', 'down:end'])
})

test('a failed feedback write does not block the latest queued choice', async () => {
  const { KeyedSerialTaskQueue } = loadBundledModule(
    'src/hooks/keyed-serial-task-queue.ts',
  )
  const queue = new KeyedSerialTaskQueue()
  const events = []
  const failed = queue.enqueue('message-1', async () => {
    events.push('first')
    throw new Error('network failed')
  })
  const latest = queue.enqueue('message-1', async () => {
    events.push('latest')
    return 'saved'
  })

  await assert.rejects(failed, /network failed/)
  assert.equal(await latest, 'saved')
  assert.deepEqual(events, ['first', 'latest'])
})

test('new assistant messages persist their billed run linkage and final answer', () => {
  const managerSource = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const repositorySource = read('electron/runtime/conversations/conversation-repository.ts')

  assert.match(managerSource, /stampAgentMessageRun\(event\.message, activeClientRunId\)/)
  assert.match(managerSource, /findLastAssistantMessageForRun\(/)
  assert.doesNotMatch(managerSource, /slice\(agentMessageCountBefore\)/)
  assert.match(managerSource, /final_answer: finalAnswerForUsage/)
  assert.match(repositorySource, /client_run_id, role, host_notice, content/)
  assert.match(repositorySource, /record\.clientRunId \?\? null/)
})

test('run linkage survives a mid-run compaction that shrinks message history', () => {
  const {
    findLastAssistantMessageForRun,
    stampAgentMessageRun,
  } = loadBundledModule('electron/runtime/agent/sessions/message-run-linkage.ts')

  const prePromptLength = 8
  const currentUser = { role: 'user', content: '本轮问题' }
  stampAgentMessageRun(currentUser, 'run-after-compaction')

  // Compaction replaces a long history with a summary plus the retained current turn.
  const compactedState = [
    { role: 'user', content: '[上下文检查点摘要]' },
    currentUser,
  ]
  const finalAssistant = {
    role: 'assistant',
    content: [{ type: 'text', text: '压缩后的最终回答' }],
  }
  stampAgentMessageRun(finalAssistant, 'run-after-compaction')
  compactedState.push(finalAssistant)

  assert.ok(compactedState.length < prePromptLength)
  assert.equal(compactedState.slice(prePromptLength).length, 0)
  assert.equal(
    findLastAssistantMessageForRun(compactedState, 'run-after-compaction'),
    finalAssistant,
  )
})
