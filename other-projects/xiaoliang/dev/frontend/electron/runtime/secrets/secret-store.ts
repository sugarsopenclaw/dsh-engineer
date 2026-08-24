import keytar from 'keytar'

const DEFAULT_SERVICE_NAME = 'com.xiaoliang.desktop.local-llm'

export class SecretStore {
  constructor(private readonly serviceName = DEFAULT_SERVICE_NAME) {}

  async getSecret(ref: string | null | undefined) {
    if (!ref) return undefined
    return (await keytar.getPassword(this.serviceName, ref)) ?? undefined
  }

  async setSecret(ref: string, value: string) {
    await keytar.setPassword(this.serviceName, ref, value)
  }

  async deleteSecret(ref: string | null | undefined) {
    if (!ref) return
    await keytar.deletePassword(this.serviceName, ref)
  }
}
