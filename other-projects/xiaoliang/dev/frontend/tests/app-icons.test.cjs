const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { crc32 } = require('node:zlib')

const frontendRoot = path.resolve(__dirname, '..')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function read(relativePath, encoding) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), encoding)
}

function readPngDimensions(buffer) {
  assert.deepEqual(buffer.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE)
  let offset = PNG_SIGNATURE.length
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const typeOffset = offset + 4
    const crcOffset = typeOffset + 4 + length
    assert.equal(crc32(buffer.subarray(typeOffset, crcOffset)), buffer.readUInt32BE(crcOffset))
    offset = crcOffset + 4
  }
  assert.equal(offset, buffer.length)
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

function readIcoEntries(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0)
  assert.equal(buffer.readUInt16LE(2), 1)
  const count = buffer.readUInt16LE(4)
  return Array.from({ length: count }, (_, index) => {
    const entryOffset = 6 + index * 16
    const width = buffer[entryOffset] || 256
    const height = buffer[entryOffset + 1] || 256
    const imageOffset = buffer.readUInt32LE(entryOffset + 12)
    assert.deepEqual(
      buffer.subarray(imageOffset, imageOffset + PNG_SIGNATURE.length),
      PNG_SIGNATURE,
    )
    return [width, height]
  })
}

function readBmpMetadata(buffer) {
  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'BM')
  return {
    width: buffer.readInt32LE(18),
    height: Math.abs(buffer.readInt32LE(22)),
    bitsPerPixel: buffer.readUInt16LE(28),
  }
}

test('the titlebar mark is shared by every visible application icon surface', () => {
  const titlebarSource = read('src/components/layout/window-titlebar.tsx', 'utf8')
  const appIconSource = read('electron/shell/app-icon.ts', 'utf8')
  const windowSource = read('electron/shell/window-manager.ts', 'utf8')
  const traySource = read('electron/shell/tray-manager.ts', 'utf8')
  const configSource = read('electron/shell/app-config.ts', 'utf8')
  const mainSource = read('electron/main.ts', 'utf8')
  const indexSource = read('index.html', 'utf8')

  assert.match(titlebarSource, /import logo from '@\/assets\/logo\.png'/)
  assert.match(appIconSource, /appConfig\.icons\.paths/)
  assert.match(windowSource, /const appIcon = getAppIcon\(\)/)
  assert.match(windowSource, /icon: appIcon/)
  assert.match(windowSource, /setIcon\(appIcon\)/)
  assert.match(windowSource, /setAppDetails\(\{/)
  assert.match(windowSource, /appId: appConfig\.appUserModelId/)
  assert.match(windowSource, /appIconPath: appConfig\.icons\.windowsPath/)
  assert.match(traySource, /new Tray\(getAppIcon\(\)\)/)
  assert.match(traySource, /icon: getAppIcon\(\)/)
  assert.match(mainSource, /app\.setAppUserModelId\(appConfig\.appUserModelId\)/)
  assert.match(indexSource, /href="\/xiaoliang\.png"/)

  const fallbackBase64 = configSource.match(/data:image\/png;base64,([^']+)/)?.[1]
  assert.ok(fallbackBase64)
  assert.deepEqual(readPngDimensions(Buffer.from(fallbackBase64, 'base64')), [32, 32])
})

test('Windows icon contains crisp layers for tray, taskbar, and installer sizes', () => {
  const icon = read('public/xiaoliang.ico')
  const expectedSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]

  assert.deepEqual(
    readIcoEntries(icon).map(([width, height]) => {
      assert.equal(width, height)
      return width
    }),
    expectedSizes,
  )
  assert.deepEqual(readPngDimensions(read('public/xiaoliang.png')), [256, 256])
})

test('packaging ships both native icon formats outside the asar archive', () => {
  const packageJson = JSON.parse(read('package.json', 'utf8'))
  const configSource = read('electron/shell/app-config.ts', 'utf8')
  const publicResource = packageJson.build.extraResources.find(
    (resource) => resource.from === 'public' && resource.to === 'public',
  )

  assert.equal(packageJson.build.win.icon, 'public/xiaoliang.ico')
  assert.match(configSource, new RegExp(`appId: '${packageJson.build.appId}'`))
  // 开发态必须使用独立 AUMID，避免开发快捷方式抢走正式版任务栏图标。
  assert.match(
    configSource,
    new RegExp(
      `appUserModelId: IS_DEV \\? '${packageJson.build.appId}\\.dev' : '${packageJson.build.appId}'`,
    ),
  )
  assert.ok(packageJson.build.files.includes('public/xiaoliang.ico'))
  assert.ok(packageJson.build.files.includes('public/xiaoliang.png'))
  assert.deepEqual(publicResource?.filter, ['xiaoliang.ico', 'xiaoliang.png'])

  assert.equal(packageJson.build.nsis.installerIcon, 'public/xiaoliang.ico')
  assert.equal(packageJson.build.nsis.uninstallerIcon, 'public/xiaoliang.ico')
  assert.equal(packageJson.build.nsis.installerHeaderIcon, 'public/xiaoliang.ico')
  assert.equal(packageJson.build.nsis.createDesktopShortcut, 'always')
  assert.equal(packageJson.build.nsis.createStartMenuShortcut, true)
  assert.equal(packageJson.build.nsis.shortcutName, '晓量')
})

test('assisted installer uses branded 24-bit header and sidebar artwork', () => {
  const packageJson = JSON.parse(read('package.json', 'utf8'))

  assert.equal(packageJson.build.nsis.installerHeader, 'installer-assets/installer-header.bmp')
  assert.equal(packageJson.build.nsis.installerSidebar, 'installer-assets/installer-sidebar.bmp')
  assert.equal(packageJson.build.nsis.uninstallerSidebar, 'installer-assets/installer-sidebar.bmp')
  assert.deepEqual(readBmpMetadata(read(packageJson.build.nsis.installerHeader)), {
    width: 150,
    height: 57,
    bitsPerPixel: 24,
  })
  assert.deepEqual(readBmpMetadata(read(packageJson.build.nsis.installerSidebar)), {
    width: 164,
    height: 314,
    bitsPerPixel: 24,
  })
})
