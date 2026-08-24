const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

function loadBundledModule(relativePath) {
  const filename = path.join(projectRoot, relativePath)
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

test('Pi queue events project editable rows with bounded display previews', () => {
  const { serializeAgentEvent } = loadBundledModule(
    'electron/runtime/agent/events/serialize-agent-event.ts',
  )

  assert.deepEqual(
    serializeAgentEvent('conversation-1', { type: 'agent_start' }, { supportsQueueing: true }),
    {
      type: 'agent_start',
      conversationId: 'conversation-1',
      supportsQueueing: true,
    },
  )
  assert.deepEqual(
    serializeAgentEvent('conversation-1', {
      type: 'agent_end',
      messages: [],
      willRetry: true,
    }),
    {
      type: 'agent_end',
      conversationId: 'conversation-1',
      willRetry: true,
    },
  )
  assert.deepEqual(
    serializeAgentEvent('conversation-1', { type: 'agent_settled' }),
    { type: 'agent_settled', conversationId: 'conversation-1' },
  )

  const longMessage = `  first\nmessage ${'x'.repeat(240)}  `
  const steering = [longMessage, 'second', ...Array.from(
    { length: 9 },
    (_, index) => `additional ${index + 1}`,
  )]
  const projected = serializeAgentEvent('conversation-1', {
    type: 'queue_update',
    steering,
    followUp: [' later  task '],
  })
  assert.equal(projected.type, 'queue_update')
  assert.equal(projected.queue.steeringCount, steering.length)
  assert.equal(projected.queue.followUpCount, 1)
  assert.equal(projected.queue.items.length, steering.length + 1)
  assert.equal(projected.queue.items[0].kind, 'steer')
  assert.equal(projected.queue.items[0].text, longMessage)
  assert.equal(projected.queue.items[0].preview.includes('\n'), false)
  assert.equal(projected.queue.items[0].preview.length, 160)
  assert.equal(projected.queue.items.at(-2).preview, 'additional 9')
  assert.equal(projected.queue.items.at(-1).kind, 'followUp')
  assert.equal(projected.queue.items.at(-1).preview, 'later task')
  assert.deepEqual(projected.queue.items.at(-1).images, [])

  const withItems = serializeAgentEvent('conversation-1', {
    type: 'queue_update',
    steering: ['ignored'],
    followUp: [],
    items: [{
      id: 'q-1',
      kind: 'steer',
      text: 'keep the figure',
      images: [{
        type: 'image',
        data: 'abc',
        mimeType: 'image/png',
        name: 'figure.png',
      }],
    }],
  })
  assert.equal(withItems.queue.items.length, 1)
  assert.equal(withItems.queue.items[0].id, 'q-1')
  assert.equal(withItems.queue.items[0].preview, 'keep the figure')
  assert.equal(withItems.queue.items[0].images.length, 1)
  assert.equal(withItems.queue.items[0].images[0].mimeType, 'image/png')
})

test('stage 2 IPC keeps steer and follow-up inside the active billed run', () => {
  const contractSource = read('src/shared/ipc-contract.ts')
  const handlerSource = read('electron/runtime/ipc/ipc-handlers.ts')
  const managerSource = read('electron/runtime/agent/sessions/agent-session-manager.ts')

  assert.match(contractSource, /AGENT_STEER: 'agent:steer'/)
  assert.match(contractSource, /AGENT_FOLLOW_UP: 'agent:followUp'/)
  assert.match(contractSource, /AGENT_REMOVE_QUEUE_ITEM: 'agent:removeQueueItem'/)
  assert.match(contractSource, /AGENT_UPDATE_QUEUE_ITEM: 'agent:updateQueueItem'/)
  assert.match(contractSource, /AGENT_SET_QUEUE_ITEM_KIND: 'agent:setQueueItemKind'/)
  assert.match(contractSource, /AGENT_CLEAR_QUEUE: 'agent:clearQueue'/)
  assert.match(handlerSource, /await this\.agentSessionManager\.steerConversation/)
  assert.match(handlerSource, /await this\.agentSessionManager\.followUpConversation/)
  assert.match(handlerSource, /await this\.agentSessionManager\.removeConversationQueueItem/)
  assert.match(handlerSource, /await this\.agentSessionManager\.updateConversationQueueItem/)
  assert.match(handlerSource, /await this\.agentSessionManager\.setConversationQueueItemKind/)
  assert.match(handlerSource, /await this\.agentSessionManager\.stopConversation/)
  assert.match(managerSource, /private async queueConversationMessage/)
  assert.match(managerSource, /this\.activeClientRunIds\.has\(conversationId\)/)
  assert.match(managerSource, /当前会话已有任务在运行/)
  assert.match(managerSource, /await promptSettlement/)
  assert.match(managerSource, /finishStatus = 'stopped'/)
  assert.match(managerSource, /if \(!updatedExistingPiHost\) \{\s+void this\.releaseSessionRuntime/)
  assert.match(managerSource, /record\.piHost\?\.getQueuedItems\(\)\.length/)
  assert.match(managerSource, /heldQueueItems = existing\.piHost\.getQueuedItems\(\)/)
  assert.match(managerSource, /initialHeldQueueItems: heldQueueItems/)
  assert.match(managerSource, /this\.detachedQueueItems\.set\(conversationId, heldQueueItems\)/)
  assert.match(managerSource, /this\.detachedQueueItems\.delete\(conversationId\)/)
  assert.match(managerSource, /return this\.getManagedPiHost\(conversationId\)\.clearQueue\(\)/)
})

test('renderer closes active state on agent_settled and exposes queue controls', () => {
  const hookSource = read('src/hooks/use-local-agent-chat.ts')
  const bucketSource = read('src/hooks/conversation-runtime-buckets.ts')
  const inputSource = read('src/components/chat/chat-input-dock.tsx')
  const agentEndStart = bucketSource.indexOf("case 'agent_end':")
  const settledStart = bucketSource.indexOf("case 'agent_settled':")
  const queueStart = bucketSource.indexOf("case 'queue_update':")

  assert.ok(agentEndStart >= 0 && settledStart > agentEndStart && queueStart > settledStart)
  assert.doesNotMatch(
    bucketSource.slice(agentEndStart, settledStart),
    /isAgentRunning:\s*false/,
  )
  assert.match(
    bucketSource.slice(settledStart, queueStart),
    /isAgentRunning:\s*false/,
  )
  assert.doesNotMatch(hookSource, /await electronBridge\.steerAgent/)
  assert.match(hookSource, /await electronBridge\.followUpAgent/)
  assert.match(hookSource, /await electronBridge\.setQueueItemKind/)
  assert.match(hookSource, /await electronBridge\.removeQueueItem/)
  assert.match(hookSource, /await electronBridge\.updateQueueItem/)
  assert.doesNotMatch(hookSource, /restoreQueueToComposer/)
  assert.match(inputSource, /data-agent-queue-preview/)
  assert.doesNotMatch(inputSource, /aria-label="排队到下一轮"/)
  assert.match(inputSource, /onChangeQueueItemKind/)
  assert.match(inputSource, /aria-label="删除全部排队消息"/)
  assert.match(inputSource, /queuedItems\.map/)
  assert.match(inputSource, /onEditQueueItem/)
  assert.match(inputSource, /onRemoveQueueItem/)
  assert.match(inputSource, /<ol[^>]+aria-label="排队消息"/)
  assert.match(inputSource, /kindLabel = item\.kind === 'steer' \? '立即引导' : '下一轮'/)
  assert.doesNotMatch(inputSource, /<CornerDownRight[\s\S]{0,120}追加/)
  assert.match(inputSource, /已排队 \{queuedMessageCount\} 条/)
  assert.doesNotMatch(inputSource, /aria-label="追加到当前任务"/)
  assert.doesNotMatch(inputSource, /aria-label="本轮结束后继续"/)
  assert.match(inputSource, /正在编辑排队消息，Enter 保存，Esc 取消/)
  assert.match(hookSource, /editingQueueConversationIdRef\.current !== currentConversationId/)
  assert.match(
    hookSource,
    /editingQueueConversationIdRef\.current !== null[\s\S]{0,120}editingQueueConversationIdRef\.current === initialConversationId/,
  )
  const sendPromptStart = hookSource.indexOf('async function sendPrompt()')
  const sendPromptEnd = hookSource.indexOf('function restoreComposerStash()', sendPromptStart)
  assert.ok(sendPromptStart >= 0 && sendPromptEnd > sendPromptStart)
  assert.doesNotMatch(
    hookSource.slice(sendPromptStart, sendPromptEnd),
    /electronBridge\.removeQueueItem/,
  )
  assert.match(hookSource, /isAgentRunning && !canQueueAgentMessages && !editingQueueItemId/)
  assert.match(inputSource, /const composerDisabled = Boolean/)
  assert.match(inputSource, /disabled=\{composerDisabled \|\| voiceBusy\}/)
  assert.match(inputSource, /\{isAgentRunning \|\| !editingQueueItemId \? \(/)
})

test('application quit waits for agent shutdown before allowing Electron to exit', () => {
  const mainSource = read('electron/main.ts')
  const handlersSource = read('electron/runtime/ipc/ipc-handlers.ts')
  const managerSource = read('electron/runtime/agent/sessions/agent-session-manager.ts')

  assert.match(mainSource, /app\.on\('before-quit', \(event\) =>/)
  assert.match(mainSource, /event\.preventDefault\(\)/)
  assert.match(mainSource, /await ipcHandlers\?\.prepareToQuit\(\)/)
  assert.match(mainSource, /quitPreparationComplete = true\s+app\.quit\(\)/)
  assert.match(handlersSource, /async prepareToQuit\(\): Promise<void>/)
  assert.match(handlersSource, /await this\.agentSessionManager\.dispose\(\)/)
  assert.match(handlersSource, /await this\.cadPreviewService\.dispose\(\)/)
  assert.match(managerSource, /private async performShutdown\(\): Promise<void>/)
  assert.match(managerSource, /const promptSettlements = \[\.\.\.this\.activePromptSettlements\.values\(\)\]/)
  assert.match(managerSource, /await Promise\.allSettled/)
})
