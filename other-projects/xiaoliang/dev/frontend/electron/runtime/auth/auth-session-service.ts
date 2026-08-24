import type {
  AuthSessionData,
  CurrentUserData,
  LoginRequest,
  LoginWithEmailCodeRequest,
  RegisterRequest,
  SendEmailCodeRequest,
  SendEmailCodeResponse,
} from '../../../src/shared/backend-api'
import {
  BackendApiError,
  BackendAuthApiClient,
  isInvalidRefreshTokenError,
} from '../backend/client'
import { SecretStore } from '../secrets/secret-store'
import {
  BACKEND_AUTH_ACCESS_SECRET_REF,
  BACKEND_AUTH_REFRESH_SECRET_REF,
  clearAuthSessionMetadata,
  getStoredAuthSessionMetadata,
  upsertAuthSessionMetadata,
} from './auth-session-repository'

const BACKEND_AUTH_SERVICE_NAME = 'com.xiaoliang.desktop.backend-auth'

export class AuthSessionService {
  private readonly secretStore = new SecretStore(BACKEND_AUTH_SERVICE_NAME)
  private readonly backendClient = new BackendAuthApiClient()
  private refreshPromise: Promise<AuthSessionData | null> | null = null
  private lastKnownSession: AuthSessionData | null = null

  async getSession(): Promise<AuthSessionData | null> {
    let stored: AuthSessionData | null
    try {
      stored = await this.readPersistedSession()
    } catch (error) {
      logAuthWarning('读取持久登录态失败，保留当前内存会话。', error)
      return this.lastKnownSession
    }

    if (!stored) {
      this.lastKnownSession = null
      return null
    }
    this.lastKnownSession = stored

    try {
      return await this.syncProfile()
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 401) {
        return this.refreshSession()
      }

      return stored
    }
  }

  async register(payload: RegisterRequest) {
    const session = await this.backendClient.register(payload)
    await this.persistSession(session)
    return session
  }

  async login(payload: LoginRequest) {
    const session = await this.backendClient.login(payload)
    await this.persistSession(session)
    return session
  }

  async sendEmailLoginCode(payload: SendEmailCodeRequest): Promise<SendEmailCodeResponse | undefined> {
    return this.backendClient.sendEmailLoginCode(payload)
  }

  async loginWithEmailCode(payload: LoginWithEmailCodeRequest) {
    const session = await this.backendClient.loginWithEmailCode(payload)
    await this.persistSession(session)
    return session
  }

  async logout() {
    const stored = await this.readPersistedSession()

    try {
      if (stored?.refresh_token) {
        await this.backendClient.logout(stored.refresh_token)
      }
    } finally {
      await this.clearSession()
    }

    return { ok: true }
  }

  async syncProfile(): Promise<AuthSessionData | null> {
    let stored: AuthSessionData | null
    try {
      stored = await this.readPersistedSession()
    } catch (error) {
      logAuthWarning('同步用户资料前读取登录态失败，保留当前内存会话。', error)
      return this.lastKnownSession
    }

    if (!stored) {
      this.lastKnownSession = null
      return null
    }
    this.lastKnownSession = stored

    try {
      const currentUser = await this.backendClient.getCurrentUser(stored.access_token)
      const nextSession = mergeSession(stored, currentUser)
      await this.persistSession(nextSession)
      return nextSession
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 401) {
        return this.refreshSession()
      }

      throw error
    }
  }

  /**
   * In-memory access token without network or keytar I/O.
   * 给每次调用结算后触发的轻量刷新用；run 启动时 getSession 已预热过会话。
   */
  peekAccessToken(): string | null {
    return this.lastKnownSession?.access_token?.trim() || null
  }

  /**
   * Reads the authoritative quota without rewriting the OS credential store.
   * syncProfile() persists the session (two keytar writes) on every call, which
   * is too heavy for per-call balance refreshes; the quota itself is not part of
   * the persisted session anyway.
   */
  async readQuotaSnapshot(): Promise<AuthSessionData | null> {
    const stored = this.lastKnownSession
    const accessToken = stored?.access_token?.trim()
    if (!stored || !accessToken) {
      return this.syncProfile()
    }

    try {
      const currentUser = await this.backendClient.getCurrentUser(accessToken)
      const nextSession = mergeSession(stored, currentUser)
      this.lastKnownSession = nextSession
      return nextSession
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 401) {
        return this.syncProfile()
      }
      throw error
    }
  }

  async refreshSession(): Promise<AuthSessionData | null> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    const refresh = this.refreshSessionOnce()
    this.refreshPromise = refresh
    try {
      return await refresh
    } finally {
      if (this.refreshPromise === refresh) {
        this.refreshPromise = null
      }
    }
  }

  private async refreshSessionOnce(): Promise<AuthSessionData | null> {
    let stored: AuthSessionData | null
    try {
      stored = await this.readPersistedSession()
    } catch (error) {
      logAuthWarning('刷新前读取登录态失败，未删除现有凭据。', error)
      return this.lastKnownSession
    }

    if (!stored?.refresh_token) {
      return this.lastKnownSession
    }
    this.lastKnownSession = stored

    try {
      const refreshed = await this.backendClient.refresh(stored.refresh_token)
      await this.persistSession(refreshed)
      return refreshed
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        logAuthWarning('后端确认刷新令牌已失效，清除本地登录态。', error)
        await this.clearSession()
        return null
      }

      logAuthWarning('会话刷新暂时失败，保留现有登录态供后续重试。', error)
      return stored
    }
  }

  async clearSession() {
    this.lastKnownSession = null
    clearAuthSessionMetadata()
    await Promise.all([
      this.secretStore.deleteSecret(BACKEND_AUTH_ACCESS_SECRET_REF),
      this.secretStore.deleteSecret(BACKEND_AUTH_REFRESH_SECRET_REF),
    ])
    return { ok: true }
  }

  private async readPersistedSession(): Promise<AuthSessionData | null> {
    const metadata = getStoredAuthSessionMetadata()

    if (!metadata) {
      return null
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.secretStore.getSecret(metadata.accessSecretRef),
      this.secretStore.getSecret(metadata.refreshSecretRef),
    ])

    if (!accessToken || !refreshToken) {
      throw new Error('持久登录态元数据存在，但系统凭据暂时不可用。')
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: metadata.tokenType,
      expires_in: metadata.expiresIn,
      user: {
        id: metadata.userId,
        email: metadata.userEmail,
        display_name: metadata.userDisplayName,
      },
      organization: {
        id: metadata.organizationId,
        name: metadata.organizationName,
        slug: metadata.organizationSlug,
      },
      role: metadata.role,
    }
  }

  private async persistSession(session: AuthSessionData) {
    await Promise.all([
      this.secretStore.setSecret(BACKEND_AUTH_ACCESS_SECRET_REF, session.access_token),
      this.secretStore.setSecret(BACKEND_AUTH_REFRESH_SECRET_REF, session.refresh_token),
    ])
    upsertAuthSessionMetadata(session, {
      accessSecretRef: BACKEND_AUTH_ACCESS_SECRET_REF,
      refreshSecretRef: BACKEND_AUTH_REFRESH_SECRET_REF,
    })
    this.lastKnownSession = session
  }
}

function logAuthWarning(message: string, error: unknown) {
  if (error instanceof BackendApiError) {
    console.warn('[auth-session]', message, {
      status: error.status,
      code: error.code,
      message: error.message,
    })
    return
  }

  console.warn('[auth-session]', message, error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) })
}

function mergeSession(session: AuthSessionData, currentUser: CurrentUserData): AuthSessionData {
  return {
    ...session,
    user: currentUser.user,
    organization: currentUser.organization,
    role: currentUser.role,
    quota: currentUser.quota ?? session.quota ?? null,
  }
}
