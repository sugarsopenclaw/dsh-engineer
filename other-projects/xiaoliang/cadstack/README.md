# cadstack

`cadstack` is the stable project-facing interface over `cadkernel`,
`cadpatterns`, `cadsemantics`, and `cadtasks`. It owns the portable
`.xiaoliang/cad/facts/` view while the four upstream stores remain immutable.

Every CLI command writes exactly one JSON object on the final stdout line. Run
`cadstack --help` for the supported `ingest`, `build`, `bind`, `status`, `ask`,
`lookup`, and `probe` contracts.

