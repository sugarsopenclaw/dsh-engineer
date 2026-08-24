import * as cheerio from 'cheerio'
import TurndownService from 'turndown'

/**
 * Elements that never carry the document and reliably poison the Markdown when kept.
 * Regulation portals in particular wrap the clause text in a shell of nav trees, share
 * widgets and "related standards" rails that otherwise outweigh the article itself.
 */
const DROPPED_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'object',
  'embed',
  'canvas',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
  '[hidden]',
]

const DROPPED_CLASS_PATTERN = /(?:^|[\s_-])(?:nav|navbar|menu|sidebar|side-bar|breadcrumb|footer|header|banner|advert|ads?|adsbygoogle|cookie|consent|popup|modal|share|social|comment|related|recommend|subscribe|newsletter|toolbar|pagination|copyright|qrcode|floatbar|backtop)(?:[\s_-]|$)/iu

/** Containers that usually hold the real article, in decreasing order of confidence. */
const MAIN_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '#content',
  '.content',
  '#article',
  '.article',
  '.article-content',
  '.articleContent',
  '.TRS_Editor',
  '.Custom_UnionStyle',
  '.detail',
  '.detail-content',
  '.news_content',
  '.zoom',
  '#zoom',
]

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  })
  // Tables carry the clause matrices we care about most, and Turndown drops them by
  // default. Keeping the HTML preserves row/column adjacency instead of flattening the
  // grid into prose, which is exactly how a model ends up inventing a missing row.
  service.keep(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'sup', 'sub'])
  service.remove(['script', 'style', 'noscript'])
  return service
}

function stripBase64Payloads(markdown: string): string {
  return markdown.replace(
    /data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]+/giu,
    (_match, mime: string) => `[${mime} data removed]`,
  )
}

function collapseBlankLines(markdown: string): string {
  return markdown.replace(/\r\n?/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
}

export interface HtmlExtraction {
  title: string
  markdown: string
  usedSelector: string
}

export function extractHtmlDocument(html: string, sourceUrl: string): HtmlExtraction {
  const $ = cheerio.load(html)
  const title = ($('title').first().text() || '').trim().slice(0, 300)

  $(DROPPED_SELECTORS.join(',')).remove()
  $('[class], [id]').each((_index, element) => {
    const node = $(element)
    const token = `${node.attr('class') || ''} ${node.attr('id') || ''}`
    if (DROPPED_CLASS_PATTERN.test(token)) node.remove()
  })

  // Relative links become useless once the page leaves its origin, and a reader following
  // an evidence trail needs to be able to open the cited link directly.
  for (const [selector, attribute] of [['a[href]', 'href'], ['img[src]', 'src']] as const) {
    $(selector).each((_index, element) => {
      const node = $(element)
      const raw = node.attr(attribute)
      if (!raw) return
      try {
        node.attr(attribute, new URL(raw, sourceUrl).toString())
      } catch {
        node.removeAttr(attribute)
      }
    })
  }

  const turndown = createTurndown()
  let usedSelector = 'body'
  let best = ''
  for (const selector of MAIN_SELECTORS) {
    const node = $(selector).first()
    if (node.length === 0) continue
    const candidate = collapseBlankLines(turndown.turndown(node.html() || ''))
    if (candidate.length > best.length) {
      best = candidate
      usedSelector = selector
    }
  }

  const fullBody = collapseBlankLines(turndown.turndown($('body').html() || $.html()))
  // A "main" container that holds only a fraction of the body is usually a teaser block,
  // not the document, so the full body wins when the gap is that large.
  if (!best || best.length * 3 < fullBody.length) {
    best = fullBody
    usedSelector = 'body'
  }

  return {
    title,
    markdown: stripBase64Payloads(best),
    usedSelector,
  }
}
