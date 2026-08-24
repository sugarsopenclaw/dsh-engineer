const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const Module = require('node:module')
const esbuild = require('esbuild')

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

test('plan-mode transitions, restart fold and reminder cadence', () => {
  const mode = loadBundledModule('electron/runtime/agent/modes/plan-mode.ts')
  let state = mode.createInitialPlanState()
  state = mode.applyPreferredMode(state, 'plan')
  assert.equal(state.phase, 'pending')
  state = mode.applyPromptStart(state)
  assert.equal(state.phase, 'active')
  assert.equal(mode.nextReminderKind(state), 'full')

  state = mode.applyPromptStart(state)
  assert.equal(mode.nextReminderKind(state), 'sparse')
  state = mode.applyPreferredMode(state, 'agent')
  assert.equal(state.phase, 'active')
  assert.equal(mode.isPlanWriteRestricted(state), true)
  assert.equal(mode.nextReminderKind(state), 'sparse')
  state = mode.applyTurnEnd(state)
  assert.equal(state.phase, 'inactive')
  assert.equal(state.preferredMode, 'agent')
  assert.equal(mode.nextReminderKind(state), null)

  const pending = mode.applyPreferredMode(mode.createInitialPlanState(), 'plan')
  assert.equal(mode.foldOnRestart(pending).phase, 'inactive')
  const exiting = mode.applyPreferredMode(
    { ...mode.createInitialPlanState(), phase: 'active', preferredMode: 'plan' },
    'agent',
  )
  assert.equal(exiting.phase, 'active')
  assert.equal(mode.foldOnRestart(exiting).phase, 'inactive')
  assert.equal(mode.foldOnRestart(exiting).pendingExitReminder, false)

  const legacyExiting = {
    ...mode.createInitialPlanState(),
    preferredMode: 'agent',
    phase: 'exit_pending',
  }
  assert.equal(mode.isPlanWriteRestricted(legacyExiting), true)
  assert.equal(mode.applyTurnEnd(legacyExiting).pendingExitReminder, false)

  const approved = mode.applyPlanApproved({ ...mode.createInitialPlanState(), phase: 'active', preferredMode: 'plan' })
  assert.equal(approved.phase, 'inactive')
  const revised = mode.applyPlanRevised({ ...mode.createInitialPlanState(), awaitingPlanApproval: true })
  assert.equal(revised.phase, 'active')
  const abandoned = mode.applyPlanAbandoned({ ...mode.createInitialPlanState(), phase: 'active' })
  assert.equal(abandoned.phase, 'inactive')
})

test('plan write gate only allows the conversation plan file', () => {
  const gate = loadBundledModule('electron/runtime/agent/modes/plan-write-gate.ts')
  const cwd = path.join(os.tmpdir(), 'xiaoliang-plan-gate')
  const planFilePath = path.join(cwd, '.xiaoliang', 'plans', 'c1', 'plan.md')

  assert.equal(gate.evaluatePlanWriteGate({
    toolName: 'read',
    args: { path: 'notes.md' },
    cwd,
    planFilePath,
  }), undefined)
  assert.equal(gate.evaluatePlanWriteGate({
    toolName: 'delegate_cad',
    args: { task: '取证' },
    cwd,
    planFilePath,
  }), undefined)
  assert.equal(gate.evaluatePlanWriteGate({
    toolName: 'web_fetch',
    args: { url: 'https://example.com/reference' },
    cwd,
    planFilePath,
  }), undefined)
  assert.equal(gate.evaluatePlanWriteGate({
    toolName: 'write',
    args: { path: '.xiaoliang/plans/c1/plan.md', content: '# plan' },
    cwd,
    planFilePath,
  }), undefined)
  assert.match(gate.evaluatePlanWriteGate({
    toolName: 'write',
    args: { path: 'src/main.ts' },
    cwd,
    planFilePath,
  }).reason, /只能写入当前对话的 plan.md/)
  assert.match(gate.evaluatePlanWriteGate({
    toolName: 'component_save',
    args: { status: 'draft' },
    cwd,
    planFilePath,
  }).reason, /已拒绝 component_save/)
  assert.match(gate.evaluatePlanWriteGate({
    toolName: 'delegate_cad_drafter',
    args: { task: '出图' },
    cwd,
    planFilePath,
  }).reason, /delegate_cad_drafter/)
  for (const toolName of [
    'component_update',
    'user_skill_create',
    'user_skill_update',
    'user_skill_delete',
    'user_skill_set_enabled',
    'cad_algorithm_run',
    'delegate_blender',
    'future_mutating_tool',
  ]) {
    assert.match(gate.evaluatePlanWriteGate({
      toolName,
      args: {},
      cwd,
      planFilePath,
    }).reason, new RegExp(toolName))
  }
  assert.equal(gate.evaluatePlanWriteGate({
    toolName: '   ',
    args: {},
    cwd,
    planFilePath,
  }).block, true)
})

test('ensurePlanDocument creates an empty file without truncating existing content', async () => {
  const mode = loadBundledModule('electron/runtime/agent/modes/plan-mode.ts')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoliang-plan-'))
  const planFilePath = mode.resolvePlanDocumentPath(root, 'conv-1')
  await mode.ensurePlanDocument(planFilePath)
  assert.equal(await mode.readPlanDocument(planFilePath), '')
  await fs.writeFile(planFilePath, '# 已有计划\n', 'utf8')
  await mode.ensurePlanDocument(planFilePath)
  assert.equal(await mode.readPlanDocument(planFilePath), '# 已有计划\n')
})
