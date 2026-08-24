# cadpatterns

`cadpatterns` is the deterministic, domain-neutral pattern layer above
`cadkernel`. It reads immutable drawing and topology facts and produces a
separately persisted `PatternGraph`; it never writes inferred geometry back into
the source snapshot.

The public entry point is `PatternRuntime.build`. Specifications in
`cadpatterns/specs/*.yaml` select detectors, features, and resolution policy.

The built-in ontology deliberately stops before discipline semantics:

- enclosure and sheet-boundary candidates, text blocks, and strict table grids;
- symbol-like clusters and repeated motif groups;
- path networks, junctions, and terminals.

Every structure has a version-independent `pattern_key` and a separately
versioned `detection_id`. Candidates remain in the graph after resolution; NMS
changes status and records conflicts/alternatives instead of deleting evidence.
Gap closure is represented by `VirtualPatternGeometry` in the pattern store, so
the authored snapshot stays byte-verifiable.

```powershell
uv run cadpatterns build <snapshot-directory> --output <pattern-store-root>
uv run cadpatterns query <pattern-graph-directory> --status supported
uv run cadpatterns query <pattern-graph-directory> --signature-of <detection-id>
uv run cadpatterns report <pattern-graph-directory>
```

`PatternStore` writes `patterns-v1/<content-id>/manifest.json`,
`graph.sqlite3`, and numeric arrays. Its manifest pins the source snapshot
manifest hash. On Windows the directory component uses a portable dash in place
of the namespaced ID's colon; the manifest remains the identity authority.

Run the fast gates (unit/property tests, dependency-direction contracts, and the
performance smoke benchmark) with:

```powershell
./scripts/verify.ps1
```

Custom `--spec` sets must be closed: a producer spec requires the companion
specs of every pattern type it can emit (for example `generic.path_network`
requires `generic.network_junction` and `generic.network_terminal`; loading
`generic.symbol_like_cluster` requires `generic.repeated_motif_group`).
