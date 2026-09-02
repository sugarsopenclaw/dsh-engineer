BUSINESS_REQUIREMENTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS dataset_builds (
    dataset_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    build_status TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    source_directory TEXT NOT NULL,
    manifest TEXT NOT NULL,
    imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_documents (
    dataset_id TEXT NOT NULL,
    source_document_id TEXT NOT NULL,
    name TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    storage_ref TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    authority_rank INTEGER NOT NULL,
    parent_source_document_id TEXT,
    PRIMARY KEY (dataset_id, source_document_id)
);

CREATE TABLE IF NOT EXISTS source_evidence (
    dataset_id TEXT NOT NULL,
    source_evidence_id TEXT NOT NULL,
    source_document_id TEXT NOT NULL,
    evidence_kind TEXT NOT NULL,
    locator TEXT NOT NULL,
    verbatim_text TEXT NOT NULL,
    PRIMARY KEY (dataset_id, source_evidence_id)
);

CREATE TABLE IF NOT EXISTS requirement_nodes (
    dataset_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    requirement_kind TEXT NOT NULL,
    origin_kind TEXT NOT NULL,
    atomic INTEGER NOT NULL,
    verification_method TEXT,
    priority_order INTEGER,
    source_emphasis TEXT,
    customer_visible INTEGER NOT NULL,
    needs_confirmation INTEGER NOT NULL,
    lifecycle_status TEXT NOT NULL,
    derived_min_depth INTEGER,
    PRIMARY KEY (dataset_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS requirement_relations (
    dataset_id TEXT NOT NULL,
    requirement_relation_id TEXT NOT NULL,
    parent_requirement_id TEXT NOT NULL,
    child_requirement_id TEXT NOT NULL,
    relation_kind TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    rationale TEXT,
    origin_kind TEXT NOT NULL,
    PRIMARY KEY (dataset_id, requirement_relation_id)
);

CREATE TABLE IF NOT EXISTS requirement_source_links (
    dataset_id TEXT NOT NULL,
    requirement_source_link_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    source_evidence_id TEXT NOT NULL,
    link_kind TEXT NOT NULL,
    PRIMARY KEY (dataset_id, requirement_source_link_id)
);

CREATE TABLE IF NOT EXISTS requirement_aliases (
    dataset_id TEXT NOT NULL,
    requirement_alias_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    alternate_name TEXT NOT NULL,
    alias_kind TEXT NOT NULL,
    note TEXT,
    PRIMARY KEY (dataset_id, requirement_alias_id)
);

CREATE TABLE IF NOT EXISTS dedup_decisions (
    dataset_id TEXT NOT NULL,
    dedup_decision_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    rationale TEXT NOT NULL,
    PRIMARY KEY (dataset_id, dedup_decision_id)
);

CREATE TABLE IF NOT EXISTS dedup_decision_requirement_links (
    dataset_id TEXT NOT NULL,
    dedup_decision_requirement_link_id TEXT NOT NULL,
    dedup_decision_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    candidate_order INTEGER NOT NULL,
    PRIMARY KEY (dataset_id, dedup_decision_requirement_link_id)
);

CREATE TABLE IF NOT EXISTS scope_dimensions (
    dataset_id TEXT NOT NULL,
    scope_dimension_id TEXT NOT NULL,
    name TEXT NOT NULL,
    value_semantics TEXT NOT NULL,
    PRIMARY KEY (dataset_id, scope_dimension_id)
);

CREATE TABLE IF NOT EXISTS scope_values (
    dataset_id TEXT NOT NULL,
    scope_value_id TEXT NOT NULL,
    scope_dimension_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (dataset_id, scope_value_id)
);

CREATE TABLE IF NOT EXISTS requirement_scope_links (
    dataset_id TEXT NOT NULL,
    requirement_scope_link_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    scope_value_id TEXT NOT NULL,
    applicability TEXT NOT NULL,
    inherit_to_descendants INTEGER NOT NULL,
    PRIMARY KEY (dataset_id, requirement_scope_link_id)
);

CREATE TABLE IF NOT EXISTS acceptance_criteria (
    dataset_id TEXT NOT NULL,
    acceptance_criterion_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    criterion_statement TEXT NOT NULL,
    criterion_status TEXT NOT NULL,
    threshold TEXT,
    measurement_method TEXT NOT NULL,
    origin_kind TEXT NOT NULL,
    PRIMARY KEY (dataset_id, acceptance_criterion_id)
);

CREATE TABLE IF NOT EXISTS open_questions (
    dataset_id TEXT NOT NULL,
    open_question_id TEXT NOT NULL,
    question TEXT NOT NULL,
    blocking_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (dataset_id, open_question_id)
);

CREATE TABLE IF NOT EXISTS open_question_requirement_links (
    dataset_id TEXT NOT NULL,
    open_question_requirement_link_id TEXT NOT NULL,
    open_question_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    PRIMARY KEY (dataset_id, open_question_requirement_link_id)
);

CREATE TABLE IF NOT EXISTS graph_views (
    dataset_id TEXT NOT NULL,
    graph_view_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    layout_algorithm TEXT,
    layout_version TEXT NOT NULL,
    PRIMARY KEY (dataset_id, graph_view_id)
);

CREATE TABLE IF NOT EXISTS graph_view_filters (
    dataset_id TEXT NOT NULL,
    graph_view_filter_id TEXT NOT NULL,
    graph_view_id TEXT NOT NULL,
    scope_dimension_id TEXT NOT NULL,
    scope_value_id TEXT NOT NULL,
    operator TEXT NOT NULL,
    PRIMARY KEY (dataset_id, graph_view_filter_id)
);

CREATE TABLE IF NOT EXISTS graph_layout_positions (
    dataset_id TEXT NOT NULL,
    graph_layout_position_id TEXT NOT NULL,
    graph_view_id TEXT NOT NULL,
    node_kind TEXT NOT NULL,
    node_id TEXT NOT NULL,
    x REAL,
    y REAL,
    z REAL,
    position_source TEXT NOT NULL,
    locked INTEGER NOT NULL,
    PRIMARY KEY (dataset_id, graph_layout_position_id)
);

CREATE INDEX IF NOT EXISTS ix_requirement_source_links_requirement
    ON requirement_source_links (dataset_id, requirement_id);
CREATE INDEX IF NOT EXISTS ix_requirement_scope_links_requirement
    ON requirement_scope_links (dataset_id, requirement_id);
CREATE INDEX IF NOT EXISTS ix_graph_layout_positions_view
    ON graph_layout_positions (dataset_id, graph_view_id, node_kind);
"""

CAD_CAPABILITIES_SCHEMA = """
CREATE TABLE IF NOT EXISTS dataset_builds (
    dataset_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    build_status TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    source_directory TEXT NOT NULL,
    manifest TEXT NOT NULL,
    imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_inventories (
    dataset_id TEXT NOT NULL,
    inventory_id TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    surface TEXT NOT NULL,
    observed_host_id TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    extractor TEXT NOT NULL,
    source_artifacts TEXT NOT NULL,
    atoms_sha256 TEXT NOT NULL,
    counts TEXT NOT NULL,
    classification_counts TEXT NOT NULL,
    PRIMARY KEY (dataset_id, inventory_id)
);

CREATE TABLE IF NOT EXISTS capability_atoms (
    dataset_id TEXT NOT NULL,
    atom_id TEXT NOT NULL,
    inventory_id TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    canonical_key TEXT NOT NULL,
    surface TEXT NOT NULL,
    atom_kind TEXT NOT NULL,
    observed_host_ids TEXT NOT NULL,
    source_artifact TEXT NOT NULL,
    declaring_symbol TEXT,
    declaring_symbol_full_name TEXT,
    member TEXT NOT NULL,
    member_name TEXT NOT NULL,
    member_signature TEXT NOT NULL,
    return_type TEXT,
    is_static INTEGER NOT NULL,
    provenance TEXT NOT NULL,
    surface_metadata TEXT NOT NULL,
    classification_status TEXT NOT NULL,
    operation_kinds TEXT NOT NULL,
    domain_tags TEXT NOT NULL,
    summary TEXT,
    classification_confidence REAL,
    semantic_candidates TEXT NOT NULL,
    evidence TEXT NOT NULL,
    processor TEXT,
    processed_at TEXT,
    notes TEXT,
    PRIMARY KEY (dataset_id, atom_id)
);

CREATE TABLE IF NOT EXISTS capability_graph_snapshots (
    dataset_id TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    surface TEXT,
    observed_host_id TEXT,
    content_sha256 TEXT NOT NULL,
    atom_count INTEGER NOT NULL,
    payload_gzip BLOB NOT NULL,
    generated_at TEXT NOT NULL,
    PRIMARY KEY (dataset_id, scope_key)
);

CREATE INDEX IF NOT EXISTS ix_capability_atoms_surface
    ON capability_atoms (dataset_id, surface, atom_id);
CREATE INDEX IF NOT EXISTS ix_capability_atoms_kind
    ON capability_atoms (dataset_id, atom_kind, atom_id);
CREATE INDEX IF NOT EXISTS ix_capability_atoms_status
    ON capability_atoms (dataset_id, classification_status, atom_id);
CREATE INDEX IF NOT EXISTS ix_capability_atoms_member_name
    ON capability_atoms (dataset_id, member_name);
CREATE INDEX IF NOT EXISTS ix_capability_graph_snapshots_scope
    ON capability_graph_snapshots (dataset_id, surface, observed_host_id);
"""
