const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const frontendRoot = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8')
}

test('tree dialog shows the full node list without a granularity filter', () => {
  const dialog = read('src/components/chat/conversation-tree-dialog.tsx')
  const store = read('electron/runtime/agent/pi/pi-session-store.ts')
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')

  assert.match(dialog, /tree\?\.nodes\.length/)
  assert.match(dialog, /tree\.nodes\.map/)
  assert.match(dialog, /还没有分支记录/)
  assert.doesNotMatch(dialog, /DEFAULT_TREE_GRANULARITY|TREE_GRANULARITY_OPTIONS|分支颗粒度|还没有分叉或克隆/)
  assert.doesNotMatch(dialog, />Leaf</)
  assert.doesNotMatch(dialog, /\{selectedNode\.id\}/)
  assert.doesNotMatch(dialog, /为节点添加标签|书签已保存|onSetLabel/)
  assert.doesNotMatch(dialog, /选中节点|请先选择一个分支节点/)
  assert.match(dialog, /aria-label="分支节点操作"/)
  assert.match(dialog, /justify-end/)
  assert.match(store, /forkedChildCount: input\.forkedChildCounts\?\.get\(entry\.id\) \?\? 0/)
  assert.match(manager, /collectForkedChildCounts/)
  assert.match(manager, /child\.forkedFromEntryId/)
})
