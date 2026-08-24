import type { ScreenshotManager } from '../../../shell/screenshot-manager'
import type { ScreenshotOptions } from '../../../shell/screenshot-manager'
import type { CadCaptureHint, CadCaptureResult, CadScreenBounds } from '../contracts/cad-dto'

function buildErrorResult(message: string, hint?: CadCaptureHint): CadCaptureResult {
  return {
    success: false,
    docName: hint?.docName,
    error: message,
    capturedAt: new Date().toISOString(),
  }
}

export class CadCaptureService {
  constructor(private readonly screenshotManager: ScreenshotManager) {}

  async captureWindowByHint(
    hint: CadCaptureHint,
    options: ScreenshotOptions = {},
  ): Promise<CadCaptureResult> {
    const windowSources = await this.screenshotManager.getWindowSources()
    const needles = hint.windowTitleCandidates
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.toLowerCase())

    const matched =
      windowSources.find((source) => {
        const sourceName = source.name.toLowerCase()
        return needles.some((needle) => sourceName.includes(needle))
      }) ?? null

    if (!matched) {
      return buildErrorResult(`未找到与 AutoCAD 匹配的窗口: ${hint.preferredWindowTitle}`, hint)
    }

    const thumbnailWidth = options.thumbnailWidth || 600
    const thumbnailHeight = options.thumbnailHeight || 400
    const capture = await this.screenshotManager.captureScreenshot(matched.id, {
      thumbnailWidth,
      thumbnailHeight,
    })

    if (!capture.success) {
      return buildErrorResult(capture.error ?? '截图失败', hint)
    }

    if (!capture.data) {
      return buildErrorResult('截图返回缺少数据', hint)
    }

    return {
      success: true,
      sourceId: capture.data.id,
      sourceName: capture.data.name,
      thumbnailDataUrl: capture.data.thumbnail,
      thumbnailWidth,
      thumbnailHeight,
      docName: hint.docName,
      capturedAt: new Date(capture.timestamp).toISOString(),
      imageHash: capture.data.imageHash,
      screenshotMetrics: capture.data.screenshotMetrics,
    }
  }

  async captureScreenRegionByHint(
    hint: CadCaptureHint,
    options: ScreenshotOptions = {},
  ): Promise<CadCaptureResult> {
    const region: CadScreenBounds | undefined = hint.clientBounds ?? hint.windowBounds
    if (!region) {
      return buildErrorResult('AutoCAD 窗口缺少可用于屏幕裁剪的 bounds', hint)
    }

    const thumbnailWidth = options.thumbnailWidth || 600
    const thumbnailHeight = options.thumbnailHeight || 400
    const capture = await this.screenshotManager.captureScreenRegion(region, {
      thumbnailWidth,
      thumbnailHeight,
    })

    if (!capture.success) {
      return buildErrorResult(capture.error ?? '屏幕区域截图失败', hint)
    }

    if (!capture.data) {
      return buildErrorResult('屏幕区域截图返回缺少数据', hint)
    }

    return {
      success: true,
      sourceId: capture.data.id,
      sourceName: capture.data.name,
      thumbnailDataUrl: capture.data.thumbnail,
      thumbnailWidth,
      thumbnailHeight,
      docName: hint.docName,
      capturedAt: new Date(capture.timestamp).toISOString(),
      imageHash: capture.data.imageHash,
      screenshotMetrics: capture.data.screenshotMetrics,
    }
  }
}
