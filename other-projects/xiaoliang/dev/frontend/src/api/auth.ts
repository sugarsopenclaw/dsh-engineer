import { requestApi } from '@/api/client'
import type {
  AuthSessionData,
  CurrentUserData,
  LoginRequest,
  LoginWithEmailCodeRequest,
  RegisterRequest,
  SendEmailCodeRequest,
  SendEmailCodeResponse,
} from '@/shared/backend-api'

export function registerAccount(payload: RegisterRequest) {
  return requestApi<AuthSessionData>('/auth/register', {
    method: 'POST',
    body: payload,
    auth: false,
    allowRefresh: false,
  })
}

export function loginWithPassword(payload: LoginRequest) {
  return requestApi<AuthSessionData>('/auth/login', {
    method: 'POST',
    body: payload,
    auth: false,
    allowRefresh: false,
  })
}

export function sendEmailLoginCode(payload: SendEmailCodeRequest) {
  return requestApi<SendEmailCodeResponse | undefined>('/auth/email-otp/send', {
    method: 'POST',
    body: payload,
    auth: false,
    allowRefresh: false,
  })
}

export function loginWithEmailCode(payload: LoginWithEmailCodeRequest) {
  return requestApi<AuthSessionData>('/auth/email-otp/login', {
    method: 'POST',
    body: payload,
    auth: false,
    allowRefresh: false,
  })
}

export function logoutFromBackend(refreshToken: string) {
  return requestApi<{ ok: boolean }>('/auth/logout', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    auth: false,
    allowRefresh: false,
  })
}

export function fetchCurrentUser() {
  return requestApi<CurrentUserData>('/users/me')
}
