const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const frontendRoot = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8')
}

test('desktop window exposes compact, wide, and maximized states', () => {
  const configSource = read('electron/shell/app-config.ts')
  const managerSource = read('electron/shell/window-manager.ts')
  const ipcSource = read('src/shared/ipc-contract.ts')
  const windowStateSource = read('src/shared/window-state.ts')

  assert.match(configSource, /compact:\s*\{ width: COMPACT_WIDTH, height: COMPACT_HEIGHT \}/)
  assert.match(configSource, /const COMPACT_WIDTH = COMPACT_WINDOW_WIDTH/)
  assert.match(configSource, /wide:\s*\{ width: 1440, height: 900 \}/)
  assert.match(configSource, /defaultMode: 'wide'/)
  assert.match(windowStateSource, /mode: 'wide'/)
  assert.match(windowStateSource, /alwaysOnTop: false/)
  assert.equal(
    (managerSource.match(/setAlwaysOnTop\(true, 'screen-saver'\)/g) || []).length,
    1,
  )
  assert.match(managerSource, /workArea\.x \+ Math\.round\(\(workArea\.width - width\) \/ 2\)/)
  assert.match(managerSource, /workArea\.y \+ Math\.round\(\(workArea\.height - height\) \/ 2\)/)
  assert.match(managerSource, /setWindowMode\(mode: WindowMode\)/)
  assert.match(managerSource, /toggleMaximize\(\): WindowState/)
  assert.match(managerSource, /win\.setResizable\(false\)/)
  assert.match(managerSource, /win\.setResizable\(true\)/)
  assert.match(ipcSource, /WINDOW_STATE_CHANGED: 'window:stateChanged'/)
})

test('browser preview still follows responsive width while Electron starts wide', () => {
  const source = read('src/hooks/useWindowControl.ts')

  assert.match(source, /mode: window\.innerWidth >= WIDE_LAYOUT_MIN_WIDTH \? 'wide' : 'compact'/)
  assert.match(source, /return \{ \.\.\.DEFAULT_WINDOW_STATE \}/)
})

test('titlebar offers window mode and maximize controls with accessible names', () => {
  const source = read('src/components/layout/window-titlebar.tsx')

  assert.match(source, /切换到宽窗口/)
  assert.match(source, /切换到小窗口/)
  assert.match(source, /最大化窗口/)
  assert.match(source, /还原窗口/)
  assert.match(source, /disabled=\{compactMode\}/)
})

test('wide workspace keeps the conversation center and mounts two resizable separators', () => {
  const appSource = read('src/App.tsx')
  const layoutSource = read('src/components/layout/resizable-workspace.tsx')
  const styleSource = read('src/styles/index.css')

  assert.match(appSource, /<ResizableWorkspace/)
  assert.match(appSource, /<WorkspaceSidebar/)
  assert.match(appSource, /<AgentChatPanel/)
  assert.match(layoutSource, /role="separator"/)
  assert.match(layoutSource, /renderSeparator\('left'\)/)
  assert.match(layoutSource, /renderSeparator\('right'\)/)
  assert.match(layoutSource, /event\.key !== 'ArrowLeft' && event\.key !== 'ArrowRight'/)
  assert.match(layoutSource, /xiaoliang:workspace-panels:v5/)
  assert.match(layoutSource, /xiaoliang:workspace-panels:v4/)
  assert.match(layoutSource, /xiaoliang:workspace-panels:v3/)
  assert.match(layoutSource, /DEFAULT_LEFT_WIDTH = 250/)
  assert.match(layoutSource, /DEFAULT_RIGHT_WIDTH = 520/)
  assert.match(layoutSource, /MIN_CENTER_WIDTH = COMPACT_WINDOW_WIDTH/)
  assert.match(layoutSource, /SEPARATOR_WIDTH = 1/)
  assert.doesNotMatch(layoutSource, /MAX_RIGHT_WIDTH/)
  assert.match(layoutSource, /function maxWidthForPanel\(/)
  assert.match(layoutSource, /preferredWidthsRef/)
  assert.match(layoutSource, /savePanelWidths\(nextWidths\)/)
  assert.match(layoutSource, /WIDE_LAYOUT_MIN_WIDTH/)
  assert.match(layoutSource, /LAYOUT_SETTLE_MS/)
  assert.match(layoutSource, /setPhaseSafe\('collapsing'\)/)
  assert.match(layoutSource, /setPhaseSafe\('expanding'\)/)
  const layoutEffectStart = layoutSource.indexOf('if (mode === \'compact\')')
  const layoutEffectEnd = layoutSource.indexOf('}, [fitPreferredToContainer, mode, setDisplayWidths, setPhaseSafe])')
  assert.notEqual(layoutEffectStart, -1)
  assert.notEqual(layoutEffectEnd, -1)
  assert.doesNotMatch(layoutSource.slice(layoutEffectStart, layoutEffectEnd), /savePanelWidths\(/)
  assert.match(appSource, /<WorkbenchSidePanel/)
  assert.match(styleSource, /\.workspace-panel-separator::before \{/)
  assert.match(styleSource, /left: -3px/)
  assert.match(styleSource, /width: 7px/)
  assert.doesNotMatch(styleSource, /workspace-panel-separator\[data-panel-separator/)
})

test('project workbench no longer hosts the component-data switcher', () => {
  const workspaceSource = read('src/components/project/project-workspace.tsx')
  const workbenchSource = read('src/components/runtime/workbench-side-panel.tsx')
  const panelSource = read('src/components/project/project-components-panel.tsx')

  assert.doesNotMatch(workspaceSource, /project-components-tab/)
  assert.doesNotMatch(workspaceSource, /ProjectComponentsPanel/)
  assert.doesNotMatch(workspaceSource, /项目工作台内容/)
  assert.doesNotMatch(workspaceSource, /构件数据/)
  assert.match(workbenchSource, /workbench-tab-components/)
  assert.match(workbenchSource, /<ProjectComponentsPanel key=\{project\.id\}/)
  assert.match(panelSource, /active: boolean/)
  assert.match(panelSource, /if \(!active\) return/)
})

test('window mode switch keeps preferred panel widths and delays compact bounds', () => {
  const layoutSource = read('src/components/layout/resizable-workspace.tsx')
  const managerSource = read('electron/shell/window-manager.ts')
  const windowStateSource = read('src/shared/window-state.ts')
  const styleSource = read('src/styles/index.css')

  assert.match(windowStateSource, /WINDOW_MODE_LAYOUT_TRANSITION_MS = 180/)
  assert.match(windowStateSource, /WIDE_LAYOUT_MIN_WIDTH = 1040/)
  assert.match(windowStateSource, /COMPACT_WINDOW_WIDTH = 420/)
  assert.match(managerSource, /WINDOW_MODE_LAYOUT_TRANSITION_MS/)
  assert.match(managerSource, /compactBoundsTimer/)
  assert.match(managerSource, /clearCompactBoundsTimer/)
  assert.match(managerSource, /watchWideMinimumSize/)
  assert.match(managerSource, /applyWideMinimumSize/)
  assert.match(managerSource, /setTimeout\(\(\) => \{/)
  assert.match(layoutSource, /legacy\.left > MIN_LEFT_WIDTH && legacy\.right > MIN_RIGHT_WIDTH/)
  assert.match(layoutSource, /fitPanelWidths\(preferredWidthsRef\.current, containerWidth\)/)
  assert.match(styleSource, /body\.workspace-panel-resizing \.resizable-workspace/)
})

test('layout transition duration comes from a single shared constant', () => {
  const layoutSource = read('src/components/layout/resizable-workspace.tsx')
  const managerSource = read('electron/shell/window-manager.ts')
  const windowStateSource = read('src/shared/window-state.ts')
  const styleSource = read('src/styles/index.css')

  assert.match(windowStateSource, /WINDOW_MODE_SETTLE_GRACE_MS = 200/)
  assert.match(styleSource, /transition: grid-template-columns var\(--workspace-motion-duration/)
  assert.doesNotMatch(styleSource, /grid-template-columns \d+ms/)
  assert.match(
    layoutSource,
    /'--workspace-motion-duration': `\$\{WINDOW_MODE_LAYOUT_TRANSITION_MS\}ms`/,
  )
  assert.match(
    layoutSource,
    /WIDE_REVEAL_FALLBACK_MS = WINDOW_MODE_LAYOUT_TRANSITION_MS \+ WINDOW_MODE_SETTLE_GRACE_MS/,
  )
  assert.match(managerSource, /WINDOW_MODE_LAYOUT_TRANSITION_MS \+ WINDOW_MODE_SETTLE_GRACE_MS/)
  assert.doesNotMatch(managerSource, /WINDOW_MODE_LAYOUT_TRANSITION_MS \+ \d+/)
})

test('live separator drag writes the grid template the layout actually uses', () => {
  const layoutSource = read('src/components/layout/resizable-workspace.tsx')

  assert.match(layoutSource, /function resolveGridTemplateColumns\(phase: LayoutPhase/)
  assert.match(
    layoutSource,
    /root\.style\.gridTemplateColumns = resolveGridTemplateColumns\(phaseRef\.current, nextWidths\)/,
  )
  assert.match(layoutSource, /gridTemplateColumns: resolveGridTemplateColumns\(phase, renderedWidths\)/)
  // 渲染路径与拖拽路径之外不允许再有第三处写网格模板，否则 live drag 又会写到没人读的声明上。
  assert.equal((layoutSource.match(/gridTemplateColumns/g) || []).length, 2)
  assert.doesNotMatch(layoutSource, /--workspace-left-width/)
  assert.doesNotMatch(layoutSource, /--workspace-right-width/)
})

test('wide layout reveals and fits at the container width even below the wide minimum', () => {
  const layoutSource = read('src/components/layout/resizable-workspace.tsx')
  const managerSource = read('electron/shell/window-manager.ts')

  // 1040 只用于「展开途中先别揭示」，不能再当永久 fit/reveal 门槛。
  assert.equal((layoutSource.match(/WIDE_LAYOUT_MIN_WIDTH/g) || []).length, 2)
  assert.match(
    layoutSource,
    /if \(root\.getBoundingClientRect\(\)\.width < WIDE_LAYOUT_MIN_WIDTH\) return/,
  )
  assert.match(layoutSource, /revealFallbackTimer = window\.setTimeout/)
  assert.match(
    layoutSource,
    /if \(phaseRef\.current === 'wide'\) \{\s*fitPreferredToContainer\(\)/,
  )
  assert.match(managerSource, /applyWideMinimumSize\(win, \{ force: true \}\)/)
  assert.match(managerSource, /if \(!options\.force && !alreadyGrown\) return false/)
  assert.match(managerSource, /resolveMinimumSize\(mode: WindowMode, workArea: Rectangle\)/)
  assert.match(managerSource, /Math\.min\(configured\.width, workArea\.width\)/)
  assert.match(managerSource, /if \(maximized \|\| settledWideBounds \|\| !this\.wideWindowSnapshot\)/)
})

test('right workbench exposes an accessible replayable subagent trace surface', () => {
  const source = read('src/components/runtime/workbench-side-panel.tsx')
  const bridgeSource = read('src/services/electron-bridge.ts')

  assert.match(source, /role="tablist"/)
  assert.match(source, /role="tab"/)
  assert.match(source, /aria-selected=/)
  assert.match(source, /文件预览/)
  assert.match(source, /ProjectFilePreviewPanel/)
  assert.match(source, /tab === 'files' \? 'flex flex-col' : 'hidden'/)
  assert.match(source, /tab === 'subagents' \? 'flex' : 'hidden'/)
  assert.match(source, /enabledTabs: WorkbenchTab\[\] = \['files', 'subagents', 'components'\]/)
  assert.match(source, /workbench-tab-components/)
  assert.match(source, /<ProjectComponentsPanel/)
  assert.match(source, /构件数据/)
  assert.doesNotMatch(source, /预留功能，暂未开放/)
  assert.match(source, /% enabledTabs\.length/)
  assert.match(source, /运行记录/)
  assert.match(source, /getSubagentTrace/)
  assert.match(source, /requestAnimationFrame/)
  assert.match(source, /content-visibility:auto/)
  assert.match(bridgeSource, /subagentTraceListeners/)
  assert.match(bridgeSource, /SUBAGENT_TRACE_EVENT/)
})

test('a queued child is listed before it owns a trace, without offering a replay', () => {
  const source = read('src/components/runtime/workbench-side-panel.tsx')

  // Trace events only start at run_started, so the queue wait needs the snapshot stream.
  assert.match(source, /onAgentEvent\(\(event\) => \{[\s\S]{0,200}event\.type !== 'subagent_run'/)
  assert.match(source, /summaryFromRunUpdate\(byId\.get\(update\.childRunId\), update\)/)
  assert.match(source, /第 \$\{queuePositions\[run\.childRunId\]\} 位/)
  assert.match(source, /disabled=\{!run\.traceAvailable\}/)
  assert.match(source, /ACTIVE_RUN_STATUSES\.has\(run\.status\)[\s\S]{0,200}有子代理正在运行/)
})

test('subagent duration ticks from startedAt while a run is active', () => {
  const source = read('src/components/runtime/workbench-side-panel.tsx')

  assert.match(source, /function resolveDisplayDurationMs\(/)
  assert.match(source, /parseTimestampMs\(run\.startedAt\) \?\? parseTimestampMs\(run\.createdAt\)/)
  assert.match(source, /if \(run\.durationMs > 0\) return run\.durationMs/)
  assert.match(source, /finishedAt - startedAt/)
  assert.match(source, /function useClock\(/)
  assert.match(source, /window\.setInterval\(\(\) => setNowMs\(Date\.now\(\)\), intervalMs\)/)
  assert.match(source, /tab === 'subagents' && runs\.some\(\(run\) => ACTIVE_RUN_STATUSES\.has\(run\.status\)\)/)
  assert.match(source, /function RunDuration\(/)
  assert.match(source, /<RunDuration run=\{selectedRun\} nowMs=\{nowMs\} \/>/)
  assert.match(source, /<RunDuration run=\{run\} nowMs=\{nowMs\} \/>/)
  assert.match(source, /options\?\.live/)
  assert.doesNotMatch(source, /formatDuration\(selectedRun\.durationMs\)/)
})

test('project file preview is project-scoped, lazy, and backed by read-only IPC', () => {
  const appSource = read('src/App.tsx')
  const panelSource = read('src/components/runtime/project-file-preview-panel.tsx')
  const docxPanelSource = read('src/components/runtime/project-docx-preview.tsx')
  const docxRuntimeSource = read('src/docx-preview-runtime/entry.ts')
  const docxRuntimeHtml = read('docx-preview-runtime.html')
  const viteConfigSource = read('vite.config.ts')
  const ipcSource = read('src/shared/ipc-contract.ts')
  const ipcHandlerSource = read('electron/runtime/ipc/ipc-handlers.ts')
  const serviceSource = read('electron/runtime/project-files/project-file-service.ts')

  assert.match(appSource, /project=\{selectedProject\}/)
  assert.match(panelSource, /listProjectPreviewDirectory/)
  assert.match(panelSource, /readProjectFilePreview/)
  assert.match(panelSource, /ProjectMarkdownPreview = lazy/)
  assert.match(panelSource, /ProjectDocxPreview = lazy/)
  assert.match(panelSource, /加载更多内容/)
  assert.match(panelSource, /loadMoreInFlightRef/)
  assert.match(panelSource, /MAX_ACCUMULATED_TEXT_CHARACTERS/)
  assert.match(panelSource, /reloadHeavyPreviewRef/)
  assert.match(panelSource, /softRefresh/)
  assert.match(panelSource, /scheduleSoftRefresh/)
  assert.match(panelSource, /SOFT_REFRESH_DEBOUNCE_MS/)
  assert.match(panelSource, /wasActiveRef/)
  assert.match(panelSource, /becameActive/)
  assert.match(panelSource, /onAgentEvent/)
  assert.match(panelSource, /promptSettled/)
  assert.match(panelSource, /agent_settled/)
  assert.match(panelSource, /silent: true/)
  assert.match(panelSource, /options\?: \{ silent\?: boolean \}/)
  assert.ok((panelSource.match(/if \(options\?\.silent\) return/g) ?? []).length >= 2)
  assert.match(panelSource, /event\.projectId !== project\.id/)
  assert.match(ipcHandlerSource, /projectId: resolveAgentEventProjectId\(event\.conversationId\)/)
  assert.match(ipcHandlerSource, /return getConversationSummary\(conversationId\)\?\.projectId \?\? null/)
  assert.match(docxPanelSource, /sandbox="allow-scripts"/)
  assert.doesNotMatch(docxPanelSource, /allow-same-origin/)
  assert.match(docxPanelSource, /useLayoutEffect\(\(\) =>/)
  assert.match(docxPanelSource, /message\.type === 'ready'/)
  assert.match(docxPanelSource, /重新加载/)
  assert.match(docxRuntimeHtml, /__DOCX_RUNTIME_CSP__/)
  assert.match(docxRuntimeHtml, /__DOCX_RUNTIME_STYLE__/)
  assert.match(docxRuntimeHtml, /__DOCX_RUNTIME_SCRIPT__/)
  assert.doesNotMatch(docxRuntimeHtml, /type="module"/)
  assert.match(docxRuntimeSource, /renderAltChunks: false/)
  assert.match(docxRuntimeSource, /repairPreviewImages\(bodyContainer\)/)
  assert.match(docxRuntimeSource, /sanitizeRenderedDocument\(bodyContainer\)/)
  assert.match(docxRuntimeSource, /replaceMissingImages\(bodyContainer\)/)
  assert.ok(
    docxRuntimeSource.indexOf('repairPreviewImages(styleContainer)')
      < docxRuntimeSource.indexOf('sanitizeRenderedDocument(styleContainer)'),
  )
  assert.match(docxRuntimeSource, /root\.replaceChildren/)
  assert.match(docxRuntimeSource, /type: 'ready'/)
  assert.match(docxRuntimeSource, /error: toDocxPreviewErrorText\(error\)/)
  assert.match(viteConfigSource, /docxPreviewRuntimePlugin/)
  assert.doesNotMatch(
    viteConfigSource,
    /'docx-preview-runtime': path\.resolve\(__dirname, 'docx-preview-runtime\.html'\)/,
  )
  assert.match(ipcSource, /agent:listProjectPreviewDirectory/)
  assert.match(ipcSource, /agent:readProjectFilePreview/)
  assert.match(serviceSource, /文件预览不允许经过符号链接/)
  assert.match(serviceSource, /TEXT_PREVIEW_CHUNK_BYTES/)
  assert.match(serviceSource, /MAX_TEXT_PREVIEW_BYTES/)
  assert.match(serviceSource, /readOpenedFileBounded/)
  assert.doesNotMatch(serviceSource, /const buffer = await handle\.readFile\(\)/)
  assert.match(serviceSource, /MAX_PREVIEW_CELLS/)
})

test('docx preview runtime html is a hashed self-contained IIFE', async () => {
  const { buildDocxPreviewRuntimeHtml } = await import('../scripts/build-docx-preview-runtime.mjs')
  const html = await buildDocxPreviewRuntimeHtml()

  assert.match(html, /script-src 'sha256-/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /object-src 'none'/)
  assert.match(html, /<script>/)
  assert.doesNotMatch(html, /type="module"/)
  assert.doesNotMatch(html, /crossorigin/)
  assert.doesNotMatch(html, /modulepreload/)
  assert.doesNotMatch(html, /__DOCX_RUNTIME_CSP__/)
  assert.doesNotMatch(html, /__DOCX_RUNTIME_STYLE__/)
  assert.doesNotMatch(html, /__DOCX_RUNTIME_SCRIPT__/)
  assert.match(html, /xiaoliang:docx-preview-runtime/)
  assert.match(html, /docx-image-missing/)
  assert.match(html, /#docx-preview-root img/)

  const cspHash = html.match(/script-src 'sha256-([^']+)'/)?.[1]
  const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(cspHash)
  assert.ok(inlineScript)
  assert.equal(
    cspHash,
    crypto.createHash('sha256').update(inlineScript, 'utf8').digest('base64'),
  )
})

test('wide sidebar covers project creation and project-scoped conversation management', () => {
  const source = read('src/components/layout/workspace-sidebar.tsx')

  assert.match(source, /createProjectFromDirectory/)
  assert.match(source, /flex flex-col gap-1.5/)
  assert.match(source, /新建项目/)
  assert.match(source, /从目录创建项目/)
  assert.doesNotMatch(source, /grid-cols-\[auto_minmax\(0,1fr\)\]/)
  assert.doesNotMatch(source, /从目录打开/)
  assert.doesNotMatch(source, /createConversationInProject/)
  assert.match(source, /onOpenConversation\(project\)/)
  assert.match(source, /renameConversation/)
  assert.match(source, /setConversationPinned/)
  assert.match(source, /deleteConversation/)
  assert.match(source, /aria-haspopup="dialog"/)
  assert.match(source, /搜索项目、对话和消息/)
  assert.match(source, /<WorkspaceSearchDialog/)
  assert.match(source, /aria-expanded=\{expanded\}/)
})

test('wide center and right chrome headers share one height', () => {
  const styleSource = read('src/styles/index.css')
  const chatSource = read('src/components/runtime/agent-chat-panel.tsx')
  const workbenchSource = read('src/components/runtime/workbench-side-panel.tsx')

  assert.match(styleSource, /--workspace-panel-header-height: 48px/)
  assert.match(styleSource, /\.workspace-panel-header \{/)
  assert.match(chatSource, /className="workspace-panel-header flex items-center/)
  assert.match(workbenchSource, /className="workspace-panel-header grid grid-cols-3/)
})

test('wide conversation content uses a readable centered measure', () => {
  const source = read('src/components/runtime/agent-chat-panel.tsx')

  assert.match(source, /wideMode \? 'max-w-\[min\(860px,100%\)\]'/)
  assert.match(source, /wideMode \? 'max-w-\[860px\]'/)
})

test('env prepare rows keep path, status, and actions inside a compact settings column', () => {
  const source = read('src/components/runtime/env-prepare-panel.tsx')

  assert.match(source, /function EnvCheckRow\(/)
  assert.match(source, /detailBreak === 'all' \? 'break-all' : 'break-words'/)
  assert.match(source, /title="bash 命令行运行时"/)
  assert.match(source, /detailBreak="all"/)
  assert.match(source, /title="文本检索组件\(rg \/ fd\)"/)
  assert.match(source, /title="Blender 建模依赖\(uv 环境\)"/)
  assert.doesNotMatch(source, /truncate text-\[11px\] text-slate-500/)
  assert.doesNotMatch(
    source,
    /flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3/,
  )
})

test('settings keeps its return action in a fixed header above the scrolling content', () => {
  const source = read('src/App.tsx')
  const settingsPanelStart = source.indexOf('id="workspace-panel-settings"')
  const settingsPanel = source.slice(settingsPanelStart)

  assert.notEqual(settingsPanelStart, -1)
  assert.match(settingsPanel, /'flex min-h-0 flex-1 flex-col overflow-hidden'/)
  assert.match(settingsPanel, /<header className="workspace-panel-header/)
  assert.match(settingsPanel, /'min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto'/)
  assert.match(settingsPanel, /settings-page/)
  assert.ok(
    settingsPanel.indexOf('<header')
      < settingsPanel.indexOf("'min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto'"),
  )
})

test('project workbench keeps a fixed return header that opens the project list', () => {
  const source = read('src/App.tsx')
  const projectPanelStart = source.indexOf('id="workspace-panel-projects"')
  const chatPanelStart = source.indexOf('id="workspace-panel-chat"', projectPanelStart)
  const projectPanel = source.slice(projectPanelStart, chatPanelStart)

  assert.notEqual(projectPanelStart, -1)
  assert.notEqual(chatPanelStart, -1)
  assert.match(projectPanel, /'flex min-h-0 flex-1 flex-col overflow-hidden'/)
  assert.match(projectPanel, /\{selectedProject \? \(/)
  assert.match(projectPanel, /<header className="workspace-panel-header/)
  assert.match(projectPanel, /aria-label="返回项目列表"/)
  assert.match(projectPanel, /onClick=\{goHome\}/)
  assert.match(projectPanel, /'min-h-0 flex-1 overflow-y-auto'/)
  assert.ok(
    projectPanel.indexOf('<header') < projectPanel.indexOf("'min-h-0 flex-1 overflow-y-auto'"),
  )
})
