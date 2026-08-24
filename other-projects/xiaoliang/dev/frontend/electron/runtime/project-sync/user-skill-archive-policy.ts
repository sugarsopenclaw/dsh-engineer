export function canCommitUserSkillArchiveScan(input: {
  rootExists: boolean
  rootIsDirectory: boolean
}): boolean {
  return input.rootExists && input.rootIsDirectory
}

export function userSkillArchiveCacheKey(skillsRoot: string, relativePath: string): string {
  return `${skillsRoot.replace(/\\/g, '/')}\0${relativePath}`
}
