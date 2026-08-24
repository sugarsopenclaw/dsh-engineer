# xiaoliang-cadsemantics

`cadsemantics` is the third, evidence-grounded layer of the CAD pipeline. It
turns immutable `DrawingSnapshot` facts and a separately persisted
`PatternGraph` into deterministic drawing- and project-level semantic graphs.

The package deliberately contains no geometry engine and no model SDK. Every
assertion cites a verifiable first- or second-layer fact, unknown units remain
unresolved, and domain packs communicate only through core semantic contracts.

```powershell
uv run cadsemantics build SNAPSHOT_DIR PATTERN_STORE_DIR --output OUTPUT_DIR
uv run cadsemantics report SEMANTIC_STORE_DIR --pretty
uv run cadsemantics export SEMANTIC_STORE_DIR --out AGENT_VIEW_DIR
uv run cadsemantics packet SEMANTIC_STORE_DIR --representation SEMRES_ID
uv run cadsemantics similar SEMANTIC_STORE_DIR --representation SEMRES_ID
```

The two built-in packs are deliberately domain-neutral:
`documentation_layout` distinguishes sheets, title blocks, views, legends,
schedules, notes, and references; `generic_engineering` emits spaces, symbolic
components, networks, ports, records, labels, and assemblies. Pack overlays are
applied only in `core → cn → company → project` order.
