# cadkernel

`cadkernel` is a new, domain-neutral first layer for the Xiaoliang CAD stack. It turns
DXF into deterministic geometry/annotation/topology facts and immutable query snapshots. It has
no LLM calls, Electron dependency, room/transformer/frame detectors, or dependency on
the previous product implementations.

## Architecture

```text
DWG --explicit conversion + provenance--> DXF
DXF --> Definition/Occurrence + Annotation CAD-IR --> fixed-grid predicates
    --> explicit SnapPlan --> IncidenceGraph --> noded Arrangement --> DCEL
    --> immutable SQLite + NPY snapshot
snapshot --> exact-filtered entity/annotation/face R*Tree / FTS5 / endpoint queries
```

The CAD-IR is struct-of-arrays. `ezdxf` objects live only during adaptation; query
operators never reopen the drawing. IDs, contracts, manifests, derived-cache keys and
diagnostics serialize canonically. The enforced dependency direction is:

```text
contracts, ir -> kernel, indexes -> adapters, repair, topology -> coverage -> cli
```

The implementation covers K00–K07 plus the first-layer K08/K09 contracts: typed `OpResult` contracts, local coordinate frames
and int64 predicates, Definition/Occurrence expansion including MINSERT/OCS/transforms,
curve approximation with error provenance, structured DIMENSION/LEADER/MULTILEADER/HATCH/SOLID
facts, spatial/text/annotation/endpoint indexes, non-mutating snap plans, incidence facts,
source-supported Arrangement edges, DCEL validation, explicit-identity aggregation, and a
single capability report. Annotation-derived display geometry is queryable but excluded from
incidence and Arrangement construction by an immutable source-role column.

## Reproduce

The reference development interpreter is pinned to Python 3.11 by
`.python-version`; package metadata supports Python 3.11 through 3.13. Every
direct/build/dev dependency is exact in `pyproject.toml` and `uv.lock`.

```powershell
uv sync --all-groups
uv run pytest
uv run lint-imports
uv run cadkernel report drawing.dxf --snapshot-root .snapshots --output report.json --pretty
uv run cadkernel query .snapshots/<snapshot-id> --bbox 0 0 100 100
```

Persisted topology is read symmetrically with
`cadkernel.topology.load_topology(snapshot_path, snapshot)`. The loader rebuilds
endpoint/incidence facts that were intentionally not duplicated, checks their
stable graph identity, restores arrangement/DCEL columns, and returns a failed
`OpResult` on any integrity mismatch.

DWG is accepted only through an explicit converter. Conversion provenance stores the
converter/version and both source/output SHA-256 values. The AutoCAD COM route refuses
to `SaveAs` a drawing already open in AutoCAD, so it cannot silently rename or overwrite
the user's active document.

## Evidence

The pinned corpus uses three drawings from the
[official Autodesk AutoCAD tutorial dataset](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-OnBoarding/files/acd_foundations_main2/ACD_FOUNDATIONS_MAIN2A.html)
and three transformer engineering drawings already present in this workspace. External
DWGs/DXFs are excluded from source control; their hashes, AutoCAD conversion metadata,
runner and full outputs are retained in `tests/corpus` and `benchmarks/corpus`.

| corpus | drawings | source entities | geometry supported | structured annotations | topology edges | closed-face candidates | valid DCEL | computed compilation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| architecture | 3 | 7,736 | 7,193 | 37 | 12,775 | 3,420 | 3/3 | 1/3 |
| electrical transformer | 3 | 67,602 | 65,560 | 758 | 40,454 | 35,431 | 3/3 | 0/3 |

All six drawings parsed 100% of authored definitions. DIMENSION, LEADER, HATCH, SOLID,
and POLYLINE no longer occur in the transformer corpus unsupported reports; opaque proxy,
ATTDEF, and WIPEOUT records remain explicit. The 227/59/120 authored DIMENSION definitions
have complete measured-value-or-diagnostic coverage. All six DCELs pass Euler,
per-face geometry/area and half-edge ownership validation. Compilation now aggregates
the SnapPlan, incidence, Arrangement and DCEL decisions rather than publishing only the
last validation result. Five pinned drawings therefore remain explicitly `AMBIGUOUS`
because authored short-edge/transitive snap conflicts were already present; their face
indexes are non-queryable even though their diagnostic DCELs are structurally valid.
All grid-rounding/re-noding diagnostics are persisted and none of the six cases reports
non-convergence. The MLight comparison on the matching transformer drawing has zero
unexplained differences after accounting for attached ATTRIB/proxy representation and
the POLYLINE alias group.

Every one of the 567,964 real-corpus Arrangement edges retains at least one source
fragment; the corpus contains 678,374 occurrence/parameter-range support records.

The current three-tier baseline is in `benchmarks/baseline-final.json`:

| entities | build | snapshot | process peak | worst query p95 | budget result |
| ---: | ---: | ---: | ---: | ---: | --- |
| 2,000 | 0.59 s | 2.70 MB | 95.3 MB | 2.31 ms | pass |
| 20,000 | 2.53 s | 17.22 MB | 179.1 MB | 3.01 ms | pass |
| 300,000 | 36.71 s | 234.55 MB | 1.51 GB | 2.93 ms | pass |

The 300k acceptance budgets are build ≤60 s, snapshot ≤500 MiB, process peak ≤4 GiB,
and region/text/face query p95 ≤50 ms. The synthetic baseline measures scaling of the
full build/query spine; the real corpus separately exercises dense intersections,
blocks, unsupported records and degenerate topology.

User-selected project evidence is kept separately under
[`real-projects`](real-projects/README.md). That local, Git-ignored area captures the same
drawing through AutoCAD COM and MLightCAD, preserves source hashes and producer
fingerprints, resolves available xref files as an explicit source graph, and produces a
field-level comparison report. It is intentionally not mixed into the licensed,
hash-pinned regression corpus until a case has been authorized and desensitized.

## Corpus and performance commands

```powershell
./scripts/verify.ps1
./scripts/verify.ps1 -Corpus
./scripts/verify.ps1 -Corpus -FullBenchmark

uv run python -m tests.corpus.run_corpus --verify-only
$env:CADKERNEL_RUN_CORPUS='1'; uv run pytest -m corpus
uv run python -m tests.corpus.run_corpus
uv run python -m tests.bench.run_baseline --tiers 2000 20000 300000 --output benchmarks/baseline-final.json
```

The default verification script runs unit/property tests, import contracts and the 2k
performance smoke gate. `-Corpus` rebuilds and checks all six hash-pinned drawings in a
fresh temporary snapshot; `-FullBenchmark` additionally exercises the 60-second 300k
acceptance budget and writes an ignored local report.

Shapely dynamically links GEOS. Packaging obligations and all runtime licenses are
called out in `THIRD_PARTY_NOTICES.md`.
