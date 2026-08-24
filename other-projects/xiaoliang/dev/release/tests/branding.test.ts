import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'

const releaseRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function read(relativePath: string, encoding?: BufferEncoding) {
  return readFileSync(join(releaseRoot, relativePath), encoding)
}

function readPngDimensions(buffer: Buffer) {
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

describe('release site branding', () => {
  it('uses the Xiaoliang client mark as the tab icon, not the Vite favicon', () => {
    const indexSource = read('index.html', 'utf8')
    const navSource = read('src/sections/SiteNav.tsx', 'utf8')
    const footerSource = read('src/sections/SiteFooter.tsx', 'utf8')
    const cssSource = read('src/App.css', 'utf8')

    assert.match(indexSource, /rel="icon" type="image\/png" href="\/xiaoliang\.png"/)
    assert.match(indexSource, /rel="icon" href="\/favicon\.ico"/)
    assert.doesNotMatch(indexSource, /favicon\.svg/)
    assert.match(navSource, /const BRAND_MARK = '\/xiaoliang\.png'/)
    assert.match(footerSource, /const BRAND_MARK = '\/xiaoliang\.png'/)
    assert.doesNotMatch(navSource, /logo-xiaoliang/)
    assert.doesNotMatch(footerSource, /logo-xiaoliang/)
    assert.match(cssSource, /\.site-nav__brand img \{\s*width: 44px;\s*height: 44px;/s)
    assert.match(cssSource, /\.site-nav__product \{\s*color: var\(--text\);\s*font-size: 20px;/s)
    assert.match(cssSource, /\.site-footer__brand img \{\s*width: 48px;\s*height: 48px;/s)
    assert.match(cssSource, /\.site-footer__brand p \{\s*margin: 16px 0 0;\s*color: var\(--text\);\s*font-size: 16px;/s)
    assert.deepEqual(readPngDimensions(read('public/xiaoliang.png')), [256, 256])

    const faviconIco = read('public/favicon.ico')
    assert.equal(faviconIco.readUInt16LE(0), 0)
    assert.equal(faviconIco.readUInt16LE(2), 1)
    assert.ok(faviconIco.readUInt16LE(4) > 0)
  })

  it('shows the product name in the nav and the ICP filing in the footer', () => {
    const siteSource = read('src/site.ts', 'utf8')
    const navSource = read('src/sections/SiteNav.tsx', 'utf8')
    const footerSource = read('src/sections/SiteFooter.tsx', 'utf8')

    assert.match(siteSource, /icp: '京ICP备17059611号-3'/)
    assert.match(navSource, /SITE\.productName/)
    assert.doesNotMatch(navSource, /SITE\.company/)
    assert.match(footerSource, /备案号：\{SITE\.icp\}/)
    assert.match(footerSource, /SITE\.icpHref/)
  })
})
