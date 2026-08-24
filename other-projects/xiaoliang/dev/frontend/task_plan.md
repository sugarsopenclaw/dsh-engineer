# Task Plan

## Goal

完成 0.8.0 发版：仅提升 Electron 客户端版本号，并产出/发布新的安装包。

## Phases

- [completed] 核对 frontend 版本源与发布脚本落点
- [completed] 将 Electron 客户端版本号提升到 0.8.0
- [completed] 执行安装包打包并发布 GitHub Release

## Open Questions

- 无剩余阻塞项。

## Current Status

- `npm run build` 已通过。
- `npm run electron:publish` 已通过，并生成 `release/晓量-Setup-0.8.0.exe`。
- `release/public/晓量-Setup-0.8.0.exe` 已就绪。
- GitHub Release `v0.8.0` 已创建，`xiaoliang-setup-0.8.0.exe` 与 `.blockmap` 已上传。

## Errors Encountered

- 首次复用旧会话转录中的 GitHub token 发布失败，GitHub 返回 `401 Bad credentials`；随后改用本机 Git Credential Manager 中的有效凭据重试成功。