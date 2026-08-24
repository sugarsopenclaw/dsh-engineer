const DEFAULT_PROJECT_SCAN_IGNORED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.git',
  '.mypy_cache',
  '.next',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'venv',
])

export function isDefaultProjectArchiveIgnoredDirectory(directoryName: string): boolean {
  return DEFAULT_PROJECT_SCAN_IGNORED_DIRECTORY_NAMES.has(directoryName.trim().toLowerCase())
}
