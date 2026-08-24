# xiaoliang-cadtasks

`cadtasks` is the fourth, read-only engineering-task layer over `cadkernel`,
`cadpatterns`, and `cadsemantics`. It compiles a structured `TaskSpec` into a
versioned, type-checked DAG and produces replayable `Claim`, `AuditIssue`,
`Artifact`, and `CapabilityGap` records.

The first release deliberately contains no model SDK and no second geometry
engine. Measurements are read from immutable upstream facts or invoked through
the explicit L1 capability allowlist. Every claim is independently checked
against a bound project fact bundle before it can be stored.

## Commands

```powershell
cadtasks menu PROJECT_BINDING_JSON --out MENU_DIR
cadtasks run PROJECT_BINDING_JSON REQUEST_JSON --output TASK_ROOT
cadtasks export TASK_STORE_DIR --out AGENT_VIEW_DIR
cadtasks highlights TASK_STORE_DIR --pretty
```

A binding may contain one or more immutable snapshot/pattern/semantic triples.
All three manifests are verified and pinned into `project_snapshot_set_id`
before a task starts.

## Supported read-only recipes

- locate, identify, describe, and trace generic structures;
- count by drawing occurrence, unique label, declaration, and physical-instance
  bases, with reconciliation kept explicit;
- read enclosed area facts, check a parameterized numeric condition, and audit
  duplicate labels.

See `GAPS.md` for intentional capability boundaries.

