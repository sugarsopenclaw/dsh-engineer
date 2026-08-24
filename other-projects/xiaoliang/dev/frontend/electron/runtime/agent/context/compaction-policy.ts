/** Pi 运行时与上下文指示器共用的主会话压缩配置。 */
export const MAIN_COMPACTION_POLICY = Object.freeze({
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
})
