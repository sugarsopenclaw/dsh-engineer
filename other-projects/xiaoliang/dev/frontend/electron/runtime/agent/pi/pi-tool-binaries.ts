import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'

const PI_TOOL_BINARIES = ['rg.exe', 'fd.exe'] as const

/**
 * 把安装包预置的 rg/fd 幂等落到 Pi 托管 bin 目录(getAgentDir()/bin,
 * 即 SDK ensureTool 的第一查找路径),避免最终用户运行时从 GitHub 下载失败。
 * 已存在(Pi 自装或用户自备)时不覆盖;开发模式无预置资源,直接跳过。
 */
export async function ensurePiToolBinaries(): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) return
  const sourceDir = path.join(process.resourcesPath, 'pi-tools')
  const binDir = path.join(getAgentDir(), 'bin')
  for (const binaryName of PI_TOOL_BINARIES) {
    try {
      const sourcePath = path.join(sourceDir, binaryName)
      const targetPath = path.join(binDir, binaryName)
      if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) continue
      await fs.promises.mkdir(binDir, { recursive: true })
      await fs.promises.copyFile(sourcePath, targetPath)
    } catch (error) {
      console.warn(
        '[pi-tools] failed to seed bundled binary',
        binaryName,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}
