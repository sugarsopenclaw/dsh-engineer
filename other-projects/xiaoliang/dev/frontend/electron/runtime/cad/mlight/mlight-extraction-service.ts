/**
 * Compatibility surface for callers written against the one-shot extraction service.
 * The implementation now lives in {@link MLightCadSessionService}, which keeps the same
 * `extract` contract while adding pooled sessions and the visual operations.
 */
import {
  createDesktopMLightCadSessionService,
  MLightCadSessionService,
  type DesktopMLightCadSessionOptions,
} from './mlight-session-service'

export type {
  MLightCadDrawingRef,
  MLightCadEngine,
  MLightCadExtractionRequest,
  MLightCadExtractionResult,
  MLightCadExtractor,
} from './mlight-session-service'

export type DesktopMLightCadExtractionOptions = DesktopMLightCadSessionOptions

export const MLightCadExtractionService = MLightCadSessionService

export function createDesktopMLightCadExtractionService(
  options: DesktopMLightCadExtractionOptions = {},
): MLightCadSessionService {
  return createDesktopMLightCadSessionService(options)
}
