import { createHash } from 'node:crypto'
import { desktopCapturer, screen, type NativeImage } from 'electron'

export interface ScreenshotOptions {
  thumbnailWidth?: number
  thumbnailHeight?: number
}

export interface ScreenshotRegion {
  x: number
  y: number
  width: number
  height: number
}

interface ScreenshotImageMetrics {
  width?: number
  height?: number
  meanBrightness?: number
  brightnessVariance?: number
  blackRatio?: number
  whiteRatio?: number
  nearBlackRatio?: number
  nearWhiteRatio?: number
  byteLength?: number
}

function buildImageDiagnostics(image: NativeImage) {
  const size = image.getSize()
  const png = image.toPNG()
  const metrics: ScreenshotImageMetrics = {
    width: size.width,
    height: size.height,
    byteLength: png.byteLength,
  }

  const pixelCount = Math.max(0, size.width * size.height)
  const bitmap = image.toBitmap()
  if (pixelCount > 0 && bitmap.byteLength >= pixelCount * 4) {
    let sum = 0
    let sumSquares = 0
    let black = 0
    let white = 0
    let nearBlack = 0
    let nearWhite = 0
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4
      const blue = bitmap[offset] ?? 0
      const green = bitmap[offset + 1] ?? 0
      const red = bitmap[offset + 2] ?? 0
      const brightness = 0.299 * red + 0.587 * green + 0.114 * blue
      sum += brightness
      sumSquares += brightness * brightness
      if (brightness <= 0.5) black += 1
      if (brightness >= 254.5) white += 1
      if (brightness < 16) nearBlack += 1
      if (brightness >= 240) nearWhite += 1
    }
    const mean = sum / pixelCount
    metrics.meanBrightness = Number(mean.toFixed(4))
    metrics.brightnessVariance = Number(Math.max(0, sumSquares / pixelCount - mean * mean).toFixed(4))
    metrics.blackRatio = Number((black / pixelCount).toFixed(6))
    metrics.whiteRatio = Number((white / pixelCount).toFixed(6))
    metrics.nearBlackRatio = Number((nearBlack / pixelCount).toFixed(6))
    metrics.nearWhiteRatio = Number((nearWhite / pixelCount).toFixed(6))
  }

  return {
    thumbnail: image.toDataURL(),
    imageHash: createHash('sha256').update(png).digest('hex'),
    screenshotMetrics: metrics,
  }
}

function intersectRegion(a: ScreenshotRegion, b: ScreenshotRegion): ScreenshotRegion | null {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 <= x1 || y2 <= y1) return null
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function regionArea(region: ScreenshotRegion | null) {
  return region ? Math.max(0, region.width) * Math.max(0, region.height) : 0
}

export class ScreenshotManager {
  private isCapturing = false

  async getScreenSources() {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 150, height: 150 },
    })

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }))
  }

  async getWindowSources() {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 150, height: 150 },
    })

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }))
  }

  async captureScreenshot(sourceId: string, options: ScreenshotOptions = {}) {
    if (this.isCapturing) {
      throw new Error('截图正在进行中，请稍后再试')
    }

    this.isCapturing = true
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: {
          width: options.thumbnailWidth || 150,
          height: options.thumbnailHeight || 150,
        },
      })

      const source = sources.find((item) => item.id === sourceId)
      if (!source) {
        throw new Error(`未找到源: ${sourceId}`)
      }

      const displays = screen.getAllDisplays()
      const primaryDisplay = screen.getPrimaryDisplay()
      const display =
        (source.display_id && displays.find((item) => item.id === Number(source.display_id))) ||
        primaryDisplay

      return {
        success: true,
        data: {
          id: source.id,
          name: source.name,
          ...buildImageDiagnostics(source.thumbnail),
          display: {
            bounds: display.bounds,
            scaleFactor: display.scaleFactor,
          },
        },
        timestamp: Date.now(),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      }
    } finally {
      this.isCapturing = false
    }
  }

  async captureDesktop(options: ScreenshotOptions = {}) {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: options.thumbnailWidth || 300,
          height: options.thumbnailHeight || 200,
        },
      })

      if (sources.length === 0) {
        throw new Error('未找到可用的屏幕')
      }

      const primaryDisplay = screen.getPrimaryDisplay()
      const primaryScreen = sources[0]

      return {
        success: true,
        data: {
          id: primaryScreen.id,
          name: primaryScreen.name,
          thumbnail: primaryScreen.thumbnail.toDataURL(),
          display: {
            bounds: primaryDisplay.bounds,
            scaleFactor: primaryDisplay.scaleFactor,
            size: primaryDisplay.size,
            workArea: primaryDisplay.workArea,
          },
        },
        timestamp: Date.now(),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      }
    }
  }

  async captureScreenRegion(region: ScreenshotRegion, options: ScreenshotOptions = {}) {
    if (this.isCapturing) {
      throw new Error('截图正在进行中，请稍后再试')
    }
    if (region.width <= 0 || region.height <= 0) {
      return {
        success: false,
        error: `截图区域无效: ${JSON.stringify(region)}`,
        timestamp: Date.now(),
      }
    }

    this.isCapturing = true
    try {
      const displays = screen.getAllDisplays()
      const matchedDisplay = displays
        .map((display) => ({
          display,
          intersection: intersectRegion(region, display.bounds),
        }))
        .sort((a, b) => regionArea(b.intersection) - regionArea(a.intersection))[0]?.display
        || screen.getPrimaryDisplay()

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: matchedDisplay.size.width,
          height: matchedDisplay.size.height,
        },
      })
      const source =
        sources.find((item) => item.display_id && Number(item.display_id) === matchedDisplay.id) ||
        sources[0]
      if (!source) {
        throw new Error('未找到可用的屏幕')
      }

      const imageSize = source.thumbnail.getSize()
      const scaleX = imageSize.width / Math.max(1, matchedDisplay.bounds.width)
      const scaleY = imageSize.height / Math.max(1, matchedDisplay.bounds.height)
      const displayIntersection = intersectRegion(region, matchedDisplay.bounds) || region
      const crop = {
        x: Math.max(0, Math.round((displayIntersection.x - matchedDisplay.bounds.x) * scaleX)),
        y: Math.max(0, Math.round((displayIntersection.y - matchedDisplay.bounds.y) * scaleY)),
        width: Math.max(1, Math.round(displayIntersection.width * scaleX)),
        height: Math.max(1, Math.round(displayIntersection.height * scaleY)),
      }
      crop.width = Math.min(crop.width, Math.max(1, imageSize.width - crop.x))
      crop.height = Math.min(crop.height, Math.max(1, imageSize.height - crop.y))

      const cropped = source.thumbnail.crop(crop)
      const resized = options.thumbnailWidth && options.thumbnailHeight
        ? cropped.resize({ width: options.thumbnailWidth, height: options.thumbnailHeight })
        : cropped

      return {
        success: true,
        data: {
          id: source.id,
          name: `${source.name} · region`,
          ...buildImageDiagnostics(resized),
          region: displayIntersection,
          display: {
            bounds: matchedDisplay.bounds,
            scaleFactor: matchedDisplay.scaleFactor,
            size: matchedDisplay.size,
            workArea: matchedDisplay.workArea,
          },
        },
        timestamp: Date.now(),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      }
    } finally {
      this.isCapturing = false
    }
  }

  async captureAllScreens(options: ScreenshotOptions = {}) {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: options.thumbnailWidth || 300,
          height: options.thumbnailHeight || 200,
        },
      })

      const displays = screen.getAllDisplays()
      const screenshots = sources.map((source) => {
        const display =
          (source.display_id && displays.find((item) => item.id === Number(source.display_id))) ||
          screen.getPrimaryDisplay()

        return {
          id: source.id,
          name: source.name,
          thumbnail: source.thumbnail.toDataURL(),
          display: {
            bounds: display.bounds,
            scaleFactor: display.scaleFactor,
            size: display.size,
            workArea: display.workArea,
            internal: display.internal,
          },
        }
      })

      return {
        success: true,
        data: screenshots,
        count: screenshots.length,
        timestamp: Date.now(),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      }
    }
  }

  getStatus() {
    return {
      isCapturing: this.isCapturing,
      timestamp: Date.now(),
    }
  }
}
