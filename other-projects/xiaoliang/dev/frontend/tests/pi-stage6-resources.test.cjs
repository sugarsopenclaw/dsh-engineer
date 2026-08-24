const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
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
    banner: {
      js: "const __bundledImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
    },
    define: {
      'import.meta.url': '__bundledImportMetaUrl',
    },
    write: false,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function skillMarkdown(name, body = 'Follow the controlled workflow.') {
  return [
    '---',
    `name: ${name}`,
    `description: Controlled ${name} skill`,
    '---',
    '',
    body,
    '',
  ].join('\n')
}

test('stage 6 resolves only bundled, checksum-verified managed, and bounded project resources', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-pi-stage6-resolver-'))
  const bundledRoot = path.join(tempRoot, 'bundled')
  const managedRoot = path.join(tempRoot, 'managed')
  const projectDir = path.join(tempRoot, 'project')
  const managedSkillRoot = path.join(managedRoot, 'general', 'managed-review')
  const managedSkillContent = skillMarkdown('managed-review')
  const referenceContent = '# Review checklist\n\nCheck quantities.'
  const files = [
    { path: 'SKILL.md', content: managedSkillContent, checksum: '' },
    { path: 'references/checklist.md', content: referenceContent, checksum: '' },
  ]

  writeFile(path.join(bundledRoot, 'bundled-review', 'SKILL.md'), skillMarkdown('bundled-review'))
  writeFile(path.join(managedSkillRoot, 'SKILL.md'), managedSkillContent)
  writeFile(path.join(managedSkillRoot, 'references', 'checklist.md'), referenceContent)
  writeFile(
    path.join(projectDir, '.xiaoliang', 'prompts', 'estimate-review.md'),
    ['---', 'description: Review an estimate', '---', '', 'Review estimate $1.', ''].join('\n'),
  )
  writeFile(
    path.join(projectDir, '.xiaoliang', 'prompts', 'ignored.txt'),
    'This file must not be loaded.',
  )

  const checksum = loadBundledModule('electron/runtime/agent/skills/pack/checksum.ts')
  const skillChecksum = checksum.calculateSkillChecksum(files)
  const manifest = {
    pack_format_version: 1,
    release_channel: 'stable',
    skill_pack_version: '6.0.0',
    skill_pack_checksum: '',
    installed_at: new Date().toISOString(),
    skills: [{
      slug: 'managed-review',
      domain: 'general',
      name: 'Managed Review',
      description: 'Managed review workflow',
      version: '6.0.0',
      checksum: skillChecksum,
      updated_at: new Date().toISOString(),
      source: 'managed',
    }],
  }
  manifest.skill_pack_checksum = checksum.calculatePackChecksum({
    ...manifest,
    built_at: '',
    skills: manifest.skills.map((skill) => ({ ...skill, files: [] })),
  })
  writeFile(path.join(managedRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const {
    resolveXiaoliangPiControlledResources,
  } = loadBundledModule('electron/runtime/agent/pi/controlled-resources.ts')
  const resolved = resolveXiaoliangPiControlledResources({
    bundledSkillRoots: [bundledRoot],
    managedSkillsRoot: managedRoot,
    projectRoot: projectDir,
  })

  assert.deepEqual(resolved.diagnostics, [])
  assert.ok(resolved.skillPaths.includes(fs.realpathSync(bundledRoot)))
  assert.ok(resolved.skillPaths.includes(fs.realpathSync(managedSkillRoot)))
  assert.deepEqual(
    resolved.promptTemplatePaths.map((filePath) => path.basename(filePath)),
    ['estimate-review.md'],
  )
  assert.match(resolved.revision, /^[a-f0-9]{64}$/)

  writeFile(path.join(managedSkillRoot, 'SKILL.md'), `${managedSkillContent}\nTampered locally.`)
  const tampered = resolveXiaoliangPiControlledResources({
    bundledSkillRoots: [bundledRoot],
    managedSkillsRoot: managedRoot,
    projectRoot: projectDir,
  })
  assert.equal(tampered.skillPaths.includes(fs.realpathSync(managedSkillRoot)), false)
  assert.ok(tampered.diagnostics.some(({ code }) => code === 'managed_skill_checksum_mismatch'))
})

test('stage 6 host loads explicit resources, expands templates, reloads lifecycle, and changes tools dynamically', async () => {
  const { Type, fauxAssistantMessage, fauxProvider, fauxText } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadBundledModule(
    'electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts',
  )
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-pi-stage6-host-'))
  const controlledSkills = path.join(tempRoot, 'controlled-skills')
  const promptFile = path.join(tempRoot, 'project', '.xiaoliang', 'prompts', 'review.md')
  const rogueSkill = path.join(tempRoot, '.pi', 'skills', 'rogue', 'SKILL.md')
  const rogueExtension = path.join(tempRoot, '.pi', 'extensions', 'rogue.ts')
  writeFile(path.join(controlledSkills, 'controlled-review', 'SKILL.md'), skillMarkdown('controlled-review'))
  writeFile(promptFile, 'Review $1 with the controlled template.\n')
  writeFile(rogueSkill, skillMarkdown('rogue'))
  writeFile(rogueExtension, 'throw new Error("must never load")\n')

  let revision = 'revision-1'
  const resolveResources = () => ({
    skillPaths: [controlledSkills],
    promptTemplatePaths: [promptFile],
    diagnostics: [],
    revision,
  })
  const lifecycle = []
  const providerPrompts = []
  const faux = fauxProvider({
    provider: 'xiaoliang-stage6-host',
    tokensPerSecond: 100_000,
  })
  faux.setResponses([
    (context) => {
      providerPrompts.push({
        systemPrompt: context.systemPrompt,
        userText: context.messages.at(-1)?.content?.[0]?.text,
      })
      return fauxAssistantMessage(fauxText('first template expanded'))
    },
    (context) => {
      providerPrompts.push({
        systemPrompt: context.systemPrompt,
        userText: context.messages.at(-1)?.content?.[0]?.text,
      })
      return fauxAssistantMessage(fauxText('reloaded template expanded'))
    },
  ])

  const echoTool = {
    name: 'echo',
    label: 'Echo',
    description: 'Echo text',
    parameters: Type.Object({ text: Type.String() }),
    execute: async (_id, input) => ({
      content: [{ type: 'text', text: input.text }],
      details: {},
    }),
  }
  const trustedInlineExtension = {
    name: 'xiaoliang-trusted-probe',
    hidden: true,
    factory: (pi) => {
      pi.on('before_agent_start', (event) => ({
        systemPrompt: `${event.systemPrompt}\n[trusted-inline-extension]`,
      }))
    },
  }
  const host = await XiaoliangPiAgentHost.create({
    cwd: tempRoot,
    agentDir: path.join(tempRoot, 'agent'),
    generation: 1,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [echoTool],
    systemPrompt: 'stage 6 system prompt',
    controlledResources: {
      initial: resolveResources(),
      resolve: resolveResources,
      inlineExtensions: [trustedInlineExtension],
    },
    onSessionStart: (event) => lifecycle.push(`start:${event.reason}`),
    onSessionShutdown: (event) => lifecycle.push(`shutdown:${event.reason}`),
    onEvent: () => undefined,
  })

  try {
    const initialStatus = host.getResourceStatus()
    assert.equal(initialStatus.enabled, true)
    assert.deepEqual(initialStatus.skills.map(({ name }) => name), ['controlled-review'])
    assert.deepEqual(initialStatus.promptTemplates.map(({ name }) => name), ['review'])
    assert.equal(initialStatus.skills.some(({ name }) => name === 'rogue'), false)
    assert.equal(initialStatus.extensions.length, 2)
    assert.ok(initialStatus.extensions.every(({ path: extensionPath }) => extensionPath !== rogueExtension))
    assert.deepEqual(lifecycle, ['start:startup'])

    const skillReader = host.session.getToolDefinition('pi_skill_read')
    assert.ok(skillReader)
    const skillResult = await skillReader.execute(
      'skill-read-1',
      { name: 'controlled-review' },
      undefined,
      undefined,
      {},
    )
    assert.match(skillResult.content[0].text, /Follow the controlled workflow/)
    await assert.rejects(
      skillReader.execute(
        'skill-read-escape',
        { name: 'controlled-review', resource: '../outside.md' },
        undefined,
        undefined,
        {},
      ),
      /相对文本路径/,
    )

    writeFile(
      path.join(controlledSkills, 'controlled-review', 'SKILL.md'),
      skillMarkdown('controlled-review', 'Updated only after an explicit resource reload.'),
    )
    const snapshotResult = await skillReader.execute(
      'skill-read-snapshot',
      { name: 'controlled-review' },
      undefined,
      undefined,
      {},
    )
    assert.match(snapshotResult.content[0].text, /Follow the controlled workflow/)
    assert.doesNotMatch(snapshotResult.content[0].text, /Updated only after/)

    await host.prompt('/review alpha')
    assert.equal(providerPrompts[0].userText, 'Review alpha with the controlled template.\n')
    assert.match(providerPrompts[0].systemPrompt, /controlled-review/)
    assert.match(providerPrompts[0].systemPrompt, /trusted-inline-extension/)

    writeFile(promptFile, 'Updated review for $1.\n')
    revision = 'revision-2'
    const reloadedStatus = await host.reloadResources()
    assert.equal(reloadedStatus.revision, 'revision-2')
    assert.ok(lifecycle.includes('shutdown:reload'))
    assert.ok(lifecycle.includes('start:reload'))
    const reloadedSkillReader = host.session.getToolDefinition('pi_skill_read')
    const reloadedSkillResult = await reloadedSkillReader.execute(
      'skill-read-reloaded',
      { name: 'controlled-review' },
      undefined,
      undefined,
      {},
    )
    assert.match(reloadedSkillResult.content[0].text, /Updated only after an explicit resource reload/)
    await host.prompt('/review beta')
    assert.equal(providerPrompts[1].userText, 'Updated review for beta.\n')

    const dynamicTool = {
      name: 'dynamic_probe',
      label: 'Dynamic probe',
      description: 'Dynamically registered probe',
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }),
    }
    const registered = await host.registerTools([dynamicTool])
    assert.equal(registered.tools.find(({ name }) => name === 'dynamic_probe')?.active, true)
    const selected = host.setActiveTools(['dynamic_probe'])
    assert.equal(selected.tools.find(({ name }) => name === 'dynamic_probe')?.active, true)
    assert.equal(selected.tools.find(({ name }) => name === 'echo')?.active, false)
    await assert.rejects(
      host.replaceTools([dynamicTool], ['missing_tool']),
      /unknown replacement tools/,
    )
  } finally {
    await host.dispose()
  }

  assert.equal(lifecycle.at(-1), 'shutdown:quit')
})

test('stage 6 automatically refreshes controlled resources and keeps active-tool IPC', () => {
  const host = fs.readFileSync(
    path.join(projectRoot, 'electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts'),
    'utf8',
  )
  const manager = fs.readFileSync(
    path.join(projectRoot, 'electron/runtime/agent/sessions/agent-session-manager.ts'),
    'utf8',
  )
  const contract = fs.readFileSync(path.join(projectRoot, 'src/shared/ipc-contract.ts'), 'utf8')
  const handlers = fs.readFileSync(
    path.join(projectRoot, 'electron/runtime/ipc/ipc-handlers.ts'),
    'utf8',
  )

  assert.match(host, /noExtensions: true/)
  assert.match(host, /additionalSkillPaths: state\.skillPaths/)
  assert.match(host, /additionalPromptTemplatePaths: state\.promptTemplatePaths/)
  assert.match(host, /async reloadResources\(\)/)
  assert.match(host, /setActiveTools\(toolNames:/)
  assert.match(host, /async registerTools\(/)
  assert.doesNotMatch(host, /additionalExtensionPaths/)
  assert.match(manager, /isPiFeatureEnabled\('pi_extensions'\)/)
  assert.match(manager, /getManagedSkillsRoot\(\)/)
  assert.match(manager, /getBundledProjectDocumentSkillsRoot\(\)/)
  assert.match(manager, /getResourceStatus\(\)\.revision !== controlledResources\.revision/)
  assert.match(manager, /reloadActivePiResources\(\)/)
  assert.match(handlers, /SETTINGS_INSTALL_SKILL_UPDATE[\s\S]{0,260}reloadActivePiResources\(\)/)
  assert.match(contract, /AGENT_GET_RUNTIME_RESOURCES: 'agent:getRuntimeResources'/)
  assert.doesNotMatch(contract, /AGENT_RELOAD_RUNTIME_RESOURCES|agent:reloadRuntimeResources/)
  assert.match(contract, /AGENT_SET_ACTIVE_TOOLS: 'agent:setActiveTools'/)
})
