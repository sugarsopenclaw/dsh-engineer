export const CAD_ERROR_CODES = {
  workerStartTimeout: 'cad_worker_start_timeout',
  workerExited: 'cad_worker_exited',
  workerUnavailable: 'cad_worker_unavailable',
  requestTimeout: 'cad_request_timeout',
  scriptNotFound: 'cad_script_not_found',
  invalidResponse: 'cad_invalid_response',
  notImplemented: 'cad_not_implemented',
  approvalRequired: 'cad_approval_required',
} as const

export type CadErrorCode = (typeof CAD_ERROR_CODES)[keyof typeof CAD_ERROR_CODES]

export class CadRuntimeError extends Error {
  constructor(
    public readonly code: CadErrorCode,
    message: string,
    options?: {
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'CadRuntimeError'
    if (options?.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

export function createCadRuntimeError(
  code: CadErrorCode,
  message: string,
  cause?: unknown,
) {
  return new CadRuntimeError(code, message, { cause })
}

export function createNotImplementedCadMethodError(methodName: string) {
  return createCadRuntimeError(
    CAD_ERROR_CODES.notImplemented,
    `CAD capability not implemented yet: ${methodName}`,
  )
}
