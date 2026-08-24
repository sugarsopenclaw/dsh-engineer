const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')

function loadBundledModule(relativePath) {
  const filename = path.join(projectRoot, relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'better-sqlite3'],
    write: false,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

const protocol = loadBundledModule('electron/runtime/feishu/feishu-protocol.ts')
const slashCommands = loadBundledModule('electron/runtime/feishu/feishu-slash-commands.ts')
const channelSource = readSource('electron/runtime/feishu/feishu-channel-service.ts')
const managerSource = readSource('electron/runtime/agent/sessions/agent-session-manager.ts')
const ipcSource = readSource('electron/runtime/ipc/ipc-handlers.ts')

test('plain group messages keep one session instead of one per message', () => {
  const base = {
    isGroup: true,
    chatId: 'oc_group',
    senderId: 'ou_sender',
    groupSessionScope: 'group_topic',
  }

  // No thread ids at all: this is what an ordinary @-mention in a group looks like.
  const first = protocol.buildFeishuRouteKey({ ...base, rootId: '' })
  const second = protocol.buildFeishuRouteKey({ ...base, rootId: '' })

  assert.equal(first, second)
  assert.equal(first, 'group:oc_group')
  assert.doesNotMatch(first, /topic:/)
})

test('thread-scoped groups still route per thread, and sender scopes survive the fallback', () => {
  const inThread = protocol.buildFeishuRouteKey({
    isGroup: true,
    chatId: 'oc_group',
    senderId: 'ou_sender',
    rootId: 'om_thread_root',
    groupSessionScope: 'group_topic',
  })
  assert.equal(inThread, 'group:oc_group:topic:om_thread_root')

  const otherThread = protocol.buildFeishuRouteKey({
    isGroup: true,
    chatId: 'oc_group',
    senderId: 'ou_sender',
    rootId: 'om_other_root',
    groupSessionScope: 'group_topic',
  })
  assert.notEqual(inThread, otherThread)

  assert.equal(
    protocol.buildFeishuRouteKey({
      isGroup: true,
      chatId: 'oc_group',
      senderId: 'ou_sender',
      rootId: '',
      groupSessionScope: 'group_topic_sender',
    }),
    'group:oc_group:sender:ou_sender',
  )
  assert.equal(
    protocol.buildFeishuRouteKey({
      isGroup: true,
      chatId: 'oc_group',
      senderId: 'ou_sender',
      rootId: 'om_thread_root',
      groupSessionScope: 'group_topic_sender',
    }),
    'group:oc_group:topic:om_thread_root:sender:ou_sender',
  )
  assert.equal(
    protocol.buildFeishuRouteKey({
      isGroup: false,
      chatId: 'oc_dm',
      senderId: 'ou_sender',
      rootId: '',
      groupSessionScope: 'group_topic',
    }),
    'dm:ou_sender',
  )
})

test('a turn that produced no answer never replays the previous one', () => {
  const noAnswer = {
    finalAnswer: null,
    runAssistantText: '',
    textBuffer: '',
    errorText: null,
    status: 'completed',
  }

  assert.equal(protocol.pickRunReplyText(noAnswer), '已完成。')
  assert.equal(
    protocol.pickRunReplyText({ ...noAnswer, status: 'stopped' }),
    '本次请求已被停止。',
  )
  assert.equal(
    protocol.pickRunReplyText({ ...noAnswer, status: 'failed', errorText: '模型超时' }),
    '处理失败：模型超时',
  )
  assert.equal(
    protocol.pickRunReplyText({ ...noAnswer, status: 'failed' }),
    '处理失败，请稍后重试。',
  )

  // This run's own answer wins over anything else available.
  assert.equal(
    protocol.pickRunReplyText({ ...noAnswer, finalAnswer: '本轮答案', textBuffer: '流式片段' }),
    '本轮答案',
  )
  // Pi sessions can leave the in-memory transcript empty; persisted rows for the
  // same run are the next source, and only then the streamed buffer.
  assert.equal(
    protocol.pickRunReplyText({ ...noAnswer, runAssistantText: '持久化答案' }),
    '持久化答案',
  )
  assert.equal(
    protocol.pickRunReplyText({ ...noAnswer, textBuffer: '流式片段' }),
    '流式片段',
  )
  // A partial answer plus a terminal error reports both.
  assert.match(
    protocol.pickRunReplyText({ ...noAnswer, textBuffer: '半个答案', errorText: '连接中断' }),
    /^半个答案\n\n处理中出现错误：连接中断$/,
  )
})

test('feishu reads the run answer by client run id rather than the last assistant row', () => {
  assert.doesNotMatch(channelSource, /getLastAssistantText/)
  assert.match(
    channelSource,
    /message\.role !== 'assistant' \|\| message\.clientRunId !== clientRunId/,
  )
  assert.match(managerSource, /errorText: finishError/)
})

test('progress digest aggregates the agent loop without leaking chain of thought', () => {
  const startedAt = 1_000_000
  const progress = protocol.createRunProgress(startedAt)

  assert.match(protocol.renderRunProgress(progress, startedAt), /\*\*正在处理\*\* · 已用 0 秒/)

  progress.thinking = true
  assert.match(protocol.renderRunProgress(progress, startedAt + 5_000), /\*\*正在思考\*\* · 已用 5 秒/)

  progress.activeTools.set('call-1', 'read_file')
  progress.activeTools.set('call-2', 'bash')
  const running = protocol.renderRunProgress(progress, startedAt + 61_000)
  assert.match(running, /正在调用工具：read_file、bash/)
  assert.match(running, /已用 1 分 1 秒/)

  progress.activeTools.delete('call-1')
  progress.activeTools.delete('call-2')
  progress.finishedTools = 5
  progress.lastFinishedTool = 'cad_extract'
  progress.subagents.set('child-1', { label: '图纸分析', status: 'running' })
  progress.compaction = '正在压缩上下文'
  progress.retry = '正在重试（第 2 次 / 3）'

  const digest = protocol.renderRunProgress(progress, startedAt)
  assert.match(digest, /- 已完成 5 次工具调用，最近：cad_extract/)
  assert.match(digest, /- 子代理 图纸分析：进行中/)
  assert.match(digest, /- 正在压缩上下文/)
  assert.match(digest, /- 正在重试（第 2 次 \/ 3）/)
})

test('thinking deltas only set a flag, so no reasoning text can reach the card', () => {
  const handler = channelSource.slice(
    channelSource.indexOf('handleAgentEvent(event: AgentUiEvent)'),
    channelSource.indexOf('handleSubagentWakeSettled('),
  )

  assert.match(handler, /run\.progress\.thinking = true/)
  // Only the text kind is buffered for publication.
  assert.match(handler, /if \(event\.kind === 'text'\)\s*\{\s*run\.textBuffer \+= event\.delta/)
  assert.doesNotMatch(handler, /thinking[\s\S]{0,40}\+= event\.delta/)
})

test('thinking slash command reports when a running turn defers the change', async () => {
  const command = slashCommands.parseFeishuSlashCommand('/thinking 专家')
  const conversation = {
    id: 'conversation-thinking',
    title: 'Thinking test',
    preferredThinkingMode: 'fast',
  }
  const run = async (appliedAt) => slashCommands.handleFeishuSlashCommand(command, {
    getCurrentConversation: () => conversation,
    setConversationThinkingMode: () => ({ appliedAt }),
  })

  assert.equal(
    await run('now'),
    '已切换当前飞书会话思考档位：专家',
  )
  assert.equal(
    await run('next_turn'),
    '已切换当前飞书会话思考档位：专家；当前回合结束后生效。',
  )
  assert.match(
    channelSource,
    /setConversationThinkingMode: \(conversationId, mode\) => \(\s*this\.deps\.agent\.setConversationThinkingMode\(conversationId, mode\)\s*\)/,
  )
})

test('card updates are throttled and patched as card json', () => {
  assert.match(channelSource, /const FEISHU_STREAM_PATCH_INTERVAL_MS = 1200/)
  assert.match(
    channelSource,
    /elapsed >= FEISHU_STREAM_PATCH_INTERVAL_MS\s*\?\s*0\s*:\s*FEISHU_STREAM_PATCH_INTERVAL_MS - elapsed/,
  )
  assert.match(channelSource, /if \(!run\.cardMessageId \|\| run\.patchTimer \|\| run\.closed\) return/)
  assert.match(channelSource, /data: \{ content: cardContent \}/)
  // A progress patch must never overtake the final one and strand the card.
  assert.match(channelSource, /if \(!messageId \|\| run\.closed \|\| run\.finalizing\) return/)
  assert.match(channelSource, /run\.cardWrite = next\.then\(/)
  // The dead switches that kept streaming off are gone.
  assert.doesNotMatch(channelSource, /FEISHU_STREAMING_PATCH_ENABLED/)
  assert.doesNotMatch(readSource('src/components/runtime/llm-settings-panel.tsx'), /streaming: false/)
})

test('progress cards carry card schema and the final answer settles the same card', () => {
  const progressCard = JSON.parse(protocol.buildProgressCardContent('正在处理'))
  assert.equal(progressCard.schema, '2.0')
  assert.equal(progressCard.body.elements[0].tag, 'markdown')
  assert.equal(progressCard.body.elements[0].content, '正在处理')

  const finalCard = JSON.parse(protocol.buildMarkdownCardContent('最终答案'))
  assert.equal(finalCard.body.elements[0].content, '最终答案')

  const publish = channelSource.slice(
    channelSource.indexOf('private async publishFinal('),
    channelSource.indexOf('private resolveOutboundTarget('),
  )
  assert.match(publish, /patchCard\(cardMessageId, buildMarkdownCardContent\(chunks\[0\]\)\)/)
  // Long answers keep the existing chunk-and-append behaviour.
  assert.match(publish, /for \(const chunk of chunks\.slice\(1\)\)/)
  // A failed patch must still deliver the answer.
  assert.match(publish, /run\.cardMessageId = null\s*\n\s*run\.replyMessageId = await this\.sendText/)
})

test('an interrupted run reports itself and leaves the message replayable', () => {
  assert.match(
    protocol.buildInterruptedNotice('已经写了一半', '正在重启'),
    /^已经写了一半\n\n（本次回答被中断：正在重启。请重新发送消息继续。）$/,
  )
  assert.match(
    protocol.buildInterruptedNotice('', '客户端已退出'),
    /^本次请求未完成就被中断：客户端已退出。请重新发送消息重试。$/,
  )

  // The notice must go out before the client is torn down.
  const stop = channelSource.slice(
    channelSource.indexOf('async stop(message'),
    channelSource.indexOf('dispose()'),
  )
  assert.ok(
    stop.indexOf('flushInterruptedRun') < stop.indexOf('this.closePendingRun(run)'),
    'interrupted flush must run before the run is closed',
  )
  assert.ok(
    stop.indexOf('flushInterruptedRun') < stop.indexOf('this.client = null'),
    'interrupted flush must run before the client is dropped',
  )
  assert.match(channelSource, /if \(run\.closed && !options\.force\) return/)

  // An interrupted turn must not be recorded as processed.
  assert.match(
    channelSource,
    /if \(run\.interruptedReason\) \{\s*\n\s*throw error\s*\n\s*\}/,
  )
  const dispatch = channelSource.slice(
    channelSource.indexOf('private async processClaimedMessages('),
    channelSource.indexOf('private async processIncomingMessages('),
  )
  assert.match(dispatch, /catch \(error\) \{\s*\n\s*this\.releaseMessages\(messageIds, toErrorMessage\(error\)\)/)
})

test('plan approval fails closed on channels that cannot show the card', () => {
  const intercept = managerSource.slice(
    managerSource.indexOf('private async interceptExitPlanMode('),
    managerSource.indexOf('private async concludeLivePlanApproval('),
  )

  const gateAt = intercept.indexOf("this.activeInteractionModes.get(conversationId) !== 'a2ui'")
  assert.ok(gateAt >= 0, 'interceptExitPlanMode must check the interaction mode')
  assert.ok(
    gateAt < intercept.indexOf('waitForPersistentDecision'),
    'the gate must come before waiting on a decision that can never arrive',
  )
  // No awaiting-approval state may be left behind for a channel that cannot resolve it.
  assert.ok(
    gateAt < intercept.indexOf('markAwaitingPlanApproval(conversationId, true)'),
    'the gate must come before claiming approval state',
  )
  assert.ok(
    gateAt < intercept.indexOf('livePlanApprovalConversations.add'),
    'the gate must come before joining the live approval set',
  )
  assert.match(intercept, /block: true/)
})

test('bot identity uses the documented endpoint and mentions are not matched blindly', () => {
  assert.deepEqual(
    protocol.extractFeishuBotInfo({
      code: 0,
      msg: 'ok',
      bot: { open_id: 'ou_bot', app_name: '晓量助手' },
    }),
    { code: 0, msg: 'ok', openId: 'ou_bot', appName: '晓量助手' },
  )
  // Some transports nest the payload under data.
  assert.equal(
    protocol.extractFeishuBotInfo({ data: { bot: { open_id: 'ou_bot' } } }).openId,
    'ou_bot',
  )
  assert.deepEqual(
    protocol.extractFeishuBotInfo({ code: 99991663, msg: 'app not found' }),
    { code: 99991663, msg: 'app not found', openId: '', appName: '' },
  )
  // The legacy ping payload carried no bot open id at all.
  assert.equal(
    protocol.extractFeishuBotInfo({ data: { pingBotInfo: { botID: 'ou_bot' } } }).openId,
    '',
  )

  assert.doesNotMatch(channelSource, /openclaw_bot\/ping/)
  assert.match(channelSource, /url: '\/open-apis\/bot\/v3\/info'/)
  assert.match(channelSource, /method: 'GET'/)

  const isMentioned = channelSource.slice(
    channelSource.indexOf('private isMentioned('),
    channelSource.indexOf('private resolveMessageText('),
  )
  assert.doesNotMatch(isMentioned, /if \(!botOpenId\) return true/)
  assert.match(isMentioned, /mention\.name\?\.trim\(\) === botName/)
})

test('a subagent wake publishes its own terminal result without adopting desktop runs', () => {
  const followUp = channelSource.slice(
    channelSource.indexOf('handleSubagentWakeSettled('),
    channelSource.indexOf('private createPendingRun('),
  )

  assert.match(followUp, /pickRunReplyText\(\{/)
  assert.match(followUp, /finalAnswer: settlement\.finalAnswer/)
  assert.match(followUp, /errorText: settlement\.errorText/)
  assert.match(followUp, /status: settlement\.status/)
  assert.doesNotMatch(followUp, /pendingRuns\.has/)

  // The manager reports terminal failures too; calls that never started remain retryable.
  assert.match(
    managerSource,
    /onSettled: \(result\) => \{[\s\S]*this\.onSubagentWakeSettled\?\.\(\{/,
  )
  assert.match(managerSource, /if \(!settled\) throw error/)
  assert.match(ipcSource, /handleSubagentWakeSettled\(settlement\)/)

  // A settings restart clears the live route cache, so bindings are authoritative fallback.
  assert.match(channelSource, /FROM feishu_conversation_bindings\s*\n\s*WHERE conversation_id = \?/)
  assert.match(channelSource, /anchorMessageId: isTopicScoped && rootId \? rootId : null/)
})

test('feishu serializes all routes bound to one conversation', () => {
  const incoming = channelSource.slice(
    channelSource.indexOf('private async processIncomingMessages('),
    channelSource.indexOf('private async tryHandleSlashCommand('),
  )
  assert.match(incoming, /enqueueConversation\(conversationId/)
  assert.match(incoming, /sendPromptWhenIdle\(/)
  assert.doesNotMatch(incoming, /if \(!run\) return/)
  assert.match(
    channelSource,
    /if \(this\.pendingRuns\.get\(conversationId\) === run\) \{\s*\n\s*this\.pendingRuns\.delete/,
  )
})

test('websocket status follows real connection signals', () => {
  const restart = channelSource.slice(
    channelSource.indexOf('async restart()'),
    channelSource.indexOf('async stop(message'),
  )

  assert.match(restart, /onReady: \(\) => \{/)
  assert.match(restart, /onError: \(error: Error\) => \{/)
  assert.match(restart, /onReconnecting: \(\) => \{/)
  assert.match(restart, /onReconnected: \(\) => \{/)
  assert.match(restart, /wsConfig: \{ pingTimeout: FEISHU_WS_PING_TIMEOUT_SECONDS \}/)
  assert.match(restart, /handshakeTimeoutMs: FEISHU_WS_HANDSHAKE_TIMEOUT_MS/)

  // Starting the client must no longer claim the connection is up.
  const startAt = restart.indexOf('this.wsClient.start(')
  assert.ok(startAt >= 0)
  assert.doesNotMatch(restart.slice(startAt), /phase: 'running'/)

  // Late callbacks from a replaced connection must not overwrite the status.
  assert.match(restart, /const generation = \+\+this\.connectionGeneration/)
  assert.match(restart, /if \(!isCurrent\(\)\) return/)
})
