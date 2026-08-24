# Explicit first-release gaps

- `generic.parallel_band` is intentionally absent from L2. The first release has
  no architecture or HVAC consumer, so creating wall/duct-like band geometry
  would violate the rule that L3 does not maintain a second geometry engine.
- Cross-file identity is represented in the contracts through
  `source_snapshot_ids`, but the runtime accepts one snapshot and one
  `PatternStore` per build. Project-wide ingestion is a later orchestration step.
- There is no LLM backend, feedback subsystem, or external-classification
  runtime in this release. `SemanticInferencePort` is the sole future inference
  boundary.
- Document-region membership is decided by the persisted world-coordinate AABB
  of each pattern (plus L2 `INSIDE`/`LABELS`/`POINTS_TO` edges), never by
  polygon containment — L3 keeps no geometry engine. A candidate crossing a
  region edge stays physical, and a strongly concave region outline could
  over-demote. Only `SUPPORTED` regions demote: a legend or schedule frame
  whose lexicon does not match stays `AMBIGUOUS` and protects nothing.
- Symbol-to-schedule identity (`SAME_OBJECT_SUPPORTED`) requires an authored
  block attribute (`ATTRIB`) on the symbol side. L2 emits no label binding
  onto symbol clusters, so a plain `TEXT` tag drawn next to a symbol is not
  associated with it. `SAME_OBJECT_POSSIBLE` edges are recorded for
  downstream review but never merge by design.
- `documentation.DrawingView` is the catch-all over remaining enclosure
  candidates, and `documentation.NoteBlock` fires on every text block. Both
  are `reference_only` and produce no project objects; tighter
  frame-vs-view-vs-note separation waits for domain packs.
- `SemanticPort` preserves the L2 node id but reports connectivity-level
  `bidirectional` for every port. The per-port direction angles L2 computes
  are not lifted into L3 yet; nothing consumes them.
- `SemanticStore` writes `semantic_rtree`, but `query` loads the bundle and
  filters in memory. SQL-side spatial filtering is deferred until the store
  supports partial loading of representations.
- An aggregated representation (`generic.GenericAssembly`) and each of its
  member instances each yield their own `ProjectObject`. Whether a group is
  separately countable is a consumer-contract decision left to layer 4.
- `core.measured_value` is registered in the ontology but never produced.
  Extracting dimension-annotation values with `dimlfac` scaling is deferred
  until the annotation-to-object linkage is designed.
