"""Export CAD detail evidence as precisely joined multimodal training samples."""

from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Iterator

from flywheel.config import corpus_dir

DATASET_SCHEMA_VERSION = 1
DEFAULT_DATASET_NAME = "cad_detail_samples.jsonl"
_DETAIL_IMAGE_PREFIX = ".xiaoliang/cad/previews/"
_PATH_VALUE_KEYS = {"image_path", "path", "relative_path"}
_ENTITY_INDEX_STATUSES = {
    "valid", "missing", "untracked", "corrupt", "stale_source", "stale_pipeline",
}


@dataclass(frozen=True)
class DatasetExportOptions:
    corpus: Path | None = None
    output: Path | None = None
    user_filter: str | None = None
    include_unsaved: bool = False


@dataclass(frozen=True)
class TraceCatalogRow:
    trace_id: str
    child_run_id: str
    conversation_id: str
    client_run_id: str


@dataclass
class Turn:
    rows: list[dict[str, Any]]

    @property
    def question(self) -> str:
        for row in self.rows:
            if row.get("role") == "user":
                return str(row.get("content") or "").strip()
        return ""

    @property
    def final_answer(self) -> str:
        answers = [
            str(row.get("content") or "").strip()
            for row in self.rows
            if row.get("role") == "assistant" and str(row.get("content") or "").strip()
        ]
        return answers[-1] if answers else ""

    @property
    def client_run_ids(self) -> set[str]:
        return {
            str(row["client_run_id"])
            for row in self.rows
            if row.get("client_run_id")
        }


@dataclass
class ConversationContext:
    conversation_id: str
    local_conversation_id: str
    turns: list[Turn]
    feedback_rows: list[dict[str, Any]]


@dataclass(frozen=True)
class EvidenceRecord:
    evidence_id: str
    image_key: str
    image: str
    entities: str | None
    entity_count: int
    plotted_window: dict[str, list[int | float]]
    dwg_sha256: str | None
    drawing_saved: bool
    child_run_id: str | None
    client_run_id: str | None

    def sample_value(self, cited: bool) -> dict[str, Any]:
        return {
            "evidence_id": self.evidence_id,
            "image": self.image,
            "entities": self.entities,
            "entity_count": self.entity_count,
            "plotted_window": self.plotted_window,
            "dwg_sha256": self.dwg_sha256,
            "cited_by_main_agent": cited,
        }


@dataclass(frozen=True)
class Catalog:
    traces_by_id: dict[str, TraceCatalogRow]
    traces_by_child: dict[str, TraceCatalogRow]
    traces_by_client: dict[str, list[TraceCatalogRow]]
    feedback_rows: list[dict[str, Any]]


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None


def _iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    """Read normal JSONL and tolerate old exports split inside JSON strings."""
    try:
        source = path.open("r", encoding="utf-8-sig")
    except (OSError, UnicodeError):
        return
    buffered = ""
    try:
        with source:
            for raw in source:
                line = raw.strip()
                if not line and not buffered:
                    continue
                candidate = line if not buffered else f"{buffered}\\n{line}"
                try:
                    value = json.loads(candidate)
                except json.JSONDecodeError:
                    buffered = candidate
                    continue
                buffered = ""
                if isinstance(value, dict):
                    yield value
    except (OSError, UnicodeError):
        return


def _normal_detail_image_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip().replace("\\", "/")
    if not text or "\x00" in text:
        return None
    pure = PurePosixPath(text)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        return None
    normalized = pure.as_posix()
    # Same predicate as the TS writer's resolveSidecarPaths guard: any detail-*.png under
    # the previews root, regardless of the engine subdirectory (details/, mlight/, ...).
    if (
        not normalized.startswith(_DETAIL_IMAGE_PREFIX)
        or not pure.name.startswith("detail-")
        or not normalized.lower().endswith(".png")
    ):
        return None
    return normalized


def _extract_detail_image_paths(payload: Any) -> set[str]:
    """Extract only explicit path fields, recursively decoding JSON text tool payloads."""
    found: set[str] = set()

    def visit(value: Any, *, path_value: bool = False, depth: int = 0) -> None:
        if depth > 10:
            return
        if isinstance(value, str):
            if path_value:
                normalized = _normal_detail_image_path(value)
                if normalized:
                    found.add(normalized)
            stripped = value.strip()
            if len(stripped) <= 4 * 1024 * 1024 and stripped[:1] in {"{", "["}:
                try:
                    nested = json.loads(stripped)
                except json.JSONDecodeError:
                    return
                visit(nested, depth=depth + 1)
            return
        if isinstance(value, dict):
            for key, nested in value.items():
                visit(
                    nested,
                    path_value=str(key).lower() in _PATH_VALUE_KEYS,
                    depth=depth + 1,
                )
            return
        if isinstance(value, list):
            for nested in value:
                visit(nested, path_value=path_value, depth=depth + 1)

    visit(payload)
    return found


def _corpus_relative(corpus: Path, path: Path) -> str:
    return path.resolve().relative_to(corpus.resolve()).as_posix()


def _resolved_project_file(files_root: Path, relative: str) -> Path | None:
    try:
        candidate = (files_root / Path(*PurePosixPath(relative).parts)).resolve()
        root = files_root.resolve()
    except (OSError, RuntimeError):
        return None
    if candidate == root or root not in candidate.parents:
        return None
    return candidate


def _window(value: Any) -> dict[str, list[int | float]] | None:
    if not isinstance(value, dict):
        return None
    minimum = value.get("min")
    maximum = value.get("max")
    if not isinstance(minimum, list) or not isinstance(maximum, list):
        return None
    if len(minimum) != 2 or len(maximum) != 2:
        return None
    coordinates = [*minimum, *maximum]
    if not all(
        isinstance(item, (int, float))
        and not isinstance(item, bool)
        and math.isfinite(item)
        for item in coordinates
    ):
        return None
    if minimum[0] > maximum[0] or minimum[1] > maximum[1]:
        return None
    return {"min": list(minimum), "max": list(maximum)}


def _optional_run_id(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _read_evidence(corpus: Path, files_root: Path, evidence_path: Path) -> EvidenceRecord | None:
    payload = _load_json(evidence_path)
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        return None
    evidence_id = payload.get("evidence_id")
    image_key = _normal_detail_image_path(payload.get("image_path"))
    plotted_window = _window(payload.get("plotted_window"))
    counts = payload.get("counts")
    if (
        not isinstance(evidence_id, str)
        or not evidence_id.startswith("detail-")
        or image_key is None
        or plotted_window is None
        or not isinstance(counts, dict)
        or payload.get("selection_semantics") != "top_level_crossing"
        or payload.get("channel") not in {"com_plot", "mlight_render"}
    ):
        return None
    count_values = [
        counts.get("scanned"),
        counts.get("matched"),
        counts.get("bbox_missing"),
        counts.get("parse_failed"),
    ]
    if not all(isinstance(item, int) and not isinstance(item, bool) and item >= 0 for item in count_values):
        return None
    matched = count_values[1]

    image_path = _resolved_project_file(files_root, image_key)
    if image_path is None or not image_path.is_file():
        return None
    expected_evidence = image_path.with_name(f"{image_path.stem}.evidence.json")
    if evidence_path.resolve() != expected_evidence.resolve() or evidence_id != image_path.stem:
        return None

    index = payload.get("index")
    index_status = index.get("status") if isinstance(index, dict) else None
    if index_status not in _ENTITY_INDEX_STATUSES:
        return None
    entities_name = payload.get("entities_file")
    entities_path: Path | None = None
    if entities_name is not None:
        if index_status != "valid":
            return None
        if (
            not isinstance(entities_name, str)
            or PurePosixPath(entities_name).name != entities_name
            or entities_name != f"{evidence_id}.entities.jsonl"
        ):
            return None
        entity_key = PurePosixPath(image_key).with_name(entities_name).as_posix()
        candidate = _resolved_project_file(files_root, entity_key)
        if candidate is None or not candidate.is_file():
            return None
        entities_path = candidate
    elif index_status == "valid":
        return None

    dwg_sha256 = payload.get("dwg_sha256")
    if dwg_sha256 is not None and (
        not isinstance(dwg_sha256, str)
        or len(dwg_sha256) != 64
        or any(character not in "0123456789abcdef" for character in dwg_sha256.lower())
    ):
        return None
    # drawing.saved is optional: old evidence has no drawing block at all, so only an
    # explicit JSON false (unsaved CAD document, dbmod != 0) marks the sample unsaved.
    drawing = payload.get("drawing")
    drawing_saved = not (isinstance(drawing, dict) and drawing.get("saved") is False)
    return EvidenceRecord(
        evidence_id=evidence_id,
        image_key=image_key,
        image=_corpus_relative(corpus, image_path),
        entities=_corpus_relative(corpus, entities_path) if entities_path else None,
        entity_count=matched,
        plotted_window=plotted_window,
        dwg_sha256=dwg_sha256,
        drawing_saved=drawing_saved,
        child_run_id=_optional_run_id(payload.get("child_run_id")),
        client_run_id=_optional_run_id(payload.get("client_run_id")),
    )


def _catalog(corpus: Path) -> Catalog:
    database = corpus / "index.sqlite"
    if not database.is_file():
        return Catalog({}, {}, {}, [])
    traces_by_id: dict[str, TraceCatalogRow] = {}
    traces_by_child: dict[str, TraceCatalogRow] = {}
    traces_by_client: dict[str, list[TraceCatalogRow]] = {}
    feedback_rows: list[dict[str, Any]] = []
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        try:
            trace_rows = connection.execute(
                "SELECT id, child_run_id, conversation_archive_id, client_run_id FROM traces "
                "WHERE client_run_id IS NOT NULL AND client_run_id <> ''"
            ).fetchall()
        except sqlite3.Error:
            trace_rows = []
        for raw in trace_rows:
            item = TraceCatalogRow(
                trace_id=str(raw["id"] or ""),
                child_run_id=str(raw["child_run_id"] or ""),
                conversation_id=str(raw["conversation_archive_id"] or ""),
                client_run_id=str(raw["client_run_id"] or ""),
            )
            if item.trace_id:
                traces_by_id[item.trace_id] = item
            if item.child_run_id:
                traces_by_child[item.child_run_id] = item
            if item.client_run_id:
                traces_by_client.setdefault(item.client_run_id, []).append(item)
        try:
            feedback_rows = [dict(row) for row in connection.execute("SELECT * FROM feedback").fetchall()]
        except sqlite3.Error:
            feedback_rows = []
    except sqlite3.Error:
        pass
    finally:
        if connection is not None:
            connection.close()
    return Catalog(traces_by_id, traces_by_child, traces_by_client, feedback_rows)


def _turns(messages: list[dict[str, Any]]) -> list[Turn]:
    starts = [index for index, row in enumerate(messages) if row.get("role") == "user"]
    return [
        Turn(messages[start:(starts[position + 1] if position + 1 < len(starts) else len(messages))])
        for position, start in enumerate(starts)
    ]


def _project_conversations(project_dir: Path) -> dict[str, ConversationContext]:
    contexts: dict[str, ConversationContext] = {}
    conversations_root = project_dir / "conversations"
    if not conversations_root.is_dir():
        return contexts
    for directory in sorted(path for path in conversations_root.iterdir() if path.is_dir()):
        metadata = _load_json(directory / "conversation.json")
        if not isinstance(metadata, dict) or not metadata.get("id"):
            continue
        messages = list(_iter_jsonl(directory / "messages.jsonl"))
        feedback = _load_json(directory / "feedback.json")
        context = ConversationContext(
            conversation_id=str(metadata["id"]),
            local_conversation_id=str(metadata.get("local_conversation_id") or ""),
            turns=_turns(messages),
            feedback_rows=[item for item in feedback if isinstance(item, dict)] if isinstance(feedback, list) else [],
        )
        contexts[context.conversation_id] = context
    return contexts


def _turn_index(
    contexts: dict[str, ConversationContext],
) -> dict[tuple[str, str], tuple[ConversationContext, Turn] | None]:
    indexed: dict[tuple[str, str], tuple[ConversationContext, Turn] | None] = {}
    for context in contexts.values():
        for turn in context.turns:
            for client_run_id in turn.client_run_ids:
                key = (context.conversation_id, client_run_id)
                indexed[key] = None if key in indexed else (context, turn)
    return indexed


def _trace_row(trace_dir: Path, catalog: Catalog) -> TraceCatalogRow | None:
    metadata = _load_json(trace_dir / "meta.json")
    if not isinstance(metadata, dict):
        return None
    trace_id = str(metadata.get("id") or "")
    child_run_id = str(metadata.get("child_run_id") or "")
    return catalog.traces_by_id.get(trace_id) or catalog.traces_by_child.get(child_run_id)


def _evidence_direct_keys(evidence: EvidenceRecord, catalog: Catalog) -> set[tuple[str, str]]:
    """Join run ids carried by the evidence itself straight to the catalog, without trace.jsonl."""
    rows: list[TraceCatalogRow] = []
    if evidence.child_run_id:
        row = catalog.traces_by_child.get(evidence.child_run_id)
        if row is not None:
            rows.append(row)
    if evidence.client_run_id:
        rows.extend(catalog.traces_by_client.get(evidence.client_run_id, []))
    return {
        (row.conversation_id, row.client_run_id)
        for row in rows
        if row.conversation_id and row.client_run_id
    }


def _trace_associations(
    project_dir: Path,
    catalog: Catalog,
) -> dict[str, set[tuple[str, str]]]:
    associations: dict[str, set[tuple[str, str]]] = {}
    roots = [project_dir / "conversations", project_dir / "unassigned_traces"]
    trace_files: list[Path] = []
    for root in roots:
        if root.is_dir():
            trace_files.extend(root.rglob("trace.jsonl"))
    for trace_path in sorted(set(trace_files)):
        row = _trace_row(trace_path.parent, catalog)
        if row is None or not row.conversation_id or not row.client_run_id:
            continue
        key = (row.conversation_id, row.client_run_id)
        for event in _iter_jsonl(trace_path):
            event_type = event.get("type")
            tool_name = event.get("toolName") or event.get("tool_name")
            if event_type != "tool_end" or tool_name != "cad_detail":
                continue
            result = event.get("result") if "result" in event else event.get("toolResult")
            for image_path in _extract_detail_image_paths(result):
                associations.setdefault(image_path, set()).add(key)
    return associations


def _main_agent_evidence(
    contexts: dict[str, ConversationContext],
) -> tuple[
    dict[str, set[tuple[str, str]]],
    dict[tuple[str, str], set[str]],
]:
    fallback: dict[str, set[tuple[str, str]]] = {}
    citations: dict[tuple[str, str], set[str]] = {}
    for context in contexts.values():
        for turn in context.turns:
            turn_runs = turn.client_run_ids
            for row in turn.rows:
                if row.get("tool_name") != "cad_evidence_image":
                    continue
                row_run = str(row.get("client_run_id") or "")
                client_run_id = row_run or (next(iter(turn_runs)) if len(turn_runs) == 1 else "")
                if not client_run_id:
                    continue
                key = (context.conversation_id, client_run_id)
                for image_path in _extract_detail_image_paths(row.get("tool_args")):
                    fallback.setdefault(image_path, set()).add(key)
                    citations.setdefault(key, set()).add(image_path)
    return fallback, citations


def _feedback_issue_codes(row: dict[str, Any]) -> list[str]:
    value = row.get("issue_codes")
    if not isinstance(value, list):
        value = row.get("issue_codes_json")
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                value = []
    if not isinstance(value, list):
        return []
    return sorted({str(item).strip() for item in value if str(item).strip()})


def derive_label_status(feedback: dict[str, Any] | None) -> str:
    if not feedback:
        return "unverified"
    vote = str(feedback.get("vote") or "").lower()
    outcome = str(feedback.get("outcome") or "").lower()
    if vote == "down" or outcome == "failure":
        return "user_rejected"
    if vote == "up" or outcome == "success":
        return "user_confirmed"
    return "unverified"


def _feedback_for_turn(
    context: ConversationContext,
    turn: Turn,
    client_run_id: str,
    catalog_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    local_message_ids = {str(row["local_message_id"]) for row in turn.rows if row.get("local_message_id")}
    pi_entry_ids = {str(row["pi_entry_id"]) for row in turn.rows if row.get("pi_entry_id")}
    candidates: dict[str, dict[str, Any]] = {}
    for row in [*catalog_rows, *context.feedback_rows]:
        same_local_conversation = (
            not row.get("local_conversation_id")
            or not context.local_conversation_id
            or str(row.get("local_conversation_id")) == context.local_conversation_id
        )
        matched = same_local_conversation and str(row.get("client_run_id") or "") == client_run_id
        if same_local_conversation and row.get("local_message_id"):
            matched = matched or str(row["local_message_id"]) in local_message_ids
        if same_local_conversation and row.get("pi_entry_id"):
            matched = matched or str(row["pi_entry_id"]) in pi_entry_ids
        if matched:
            identity = str(row.get("id") or json.dumps(row, sort_keys=True, ensure_ascii=False, default=str))
            candidates[identity] = row
    selected = max(
        candidates.values(),
        key=lambda row: (str(row.get("created_at") or ""), str(row.get("id") or "")),
        default={},
    )
    return {
        "vote": selected.get("vote") or None,
        "outcome": selected.get("outcome") or None,
        "issue_codes": _feedback_issue_codes(selected),
        "comment": selected.get("comment") or None,
    }


def _sample_id(conversation_id: str, client_run_id: str) -> str:
    raw = f"cad_detail\0{conversation_id}\0{client_run_id}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _user_matches(user_dir: Path, user_filter: str | None) -> bool:
    if not user_filter:
        return True
    if user_dir.name.casefold() == user_filter.casefold():
        return True
    catalog = _load_json(user_dir / "catalog.json")
    return isinstance(catalog, dict) and str(catalog.get("email") or "").casefold() == user_filter.casefold()


def _write_jsonl_atomic(output: Path, rows: Iterable[dict[str, Any]]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as sink:
            for row in rows:
                sink.write(json.dumps(row, ensure_ascii=False, separators=(",", ":"), default=str))
                sink.write("\n")
            sink.flush()
            os.fsync(sink.fileno())
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def export_dataset(options: DatasetExportOptions | None = None) -> dict[str, Any]:
    options = options or DatasetExportOptions()
    corpus = (options.corpus or corpus_dir()).resolve()
    if not corpus.is_dir():
        raise FileNotFoundError(f"flywheel corpus does not exist: {corpus}")
    output = (options.output or corpus / "datasets" / DEFAULT_DATASET_NAME).resolve()
    warnings: list[str] = []
    if not (corpus / "index.sqlite").is_file():
        warnings.append("index.sqlite is missing; trace joins and catalog feedback were skipped.")
    catalog = _catalog(corpus)

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    stats = {
        "evidence_scanned": 0,
        "evidence_invalid": 0,
        "evidence_skipped_unsaved": 0,
        "evidence_unmatched": 0,
        "evidence_associations": 0,
    }
    users_root = corpus / "users"
    user_dirs = sorted(path for path in users_root.iterdir() if path.is_dir()) if users_root.is_dir() else []
    for user_dir in user_dirs:
        if not _user_matches(user_dir, options.user_filter):
            continue
        projects_root = user_dir / "projects"
        if not projects_root.is_dir():
            continue
        for project_dir in sorted(path for path in projects_root.iterdir() if path.is_dir()):
            files_root = project_dir / "files"
            evidence_root = files_root / ".xiaoliang"
            if not evidence_root.is_dir():
                continue
            contexts = _project_conversations(project_dir)
            turns = _turn_index(contexts)
            trace_links = _trace_associations(project_dir, catalog)
            fallback_links, citations = _main_agent_evidence(contexts)
            for evidence_path in sorted(evidence_root.rglob("detail-*.evidence.json")):
                stats["evidence_scanned"] += 1
                evidence = _read_evidence(corpus, files_root, evidence_path)
                if evidence is None:
                    stats["evidence_invalid"] += 1
                    continue
                if not evidence.drawing_saved and not options.include_unsaved:
                    stats["evidence_skipped_unsaved"] += 1
                    continue
                # Run ids declared by the evidence itself are the most authoritative
                # link; trace.jsonl and the main-agent citation stay as fallbacks.
                direct_candidates = {
                    key for key in _evidence_direct_keys(evidence, catalog)
                    if turns.get(key) is not None
                }
                trace_candidates = {
                    key for key in trace_links.get(evidence.image_key, set())
                    if turns.get(key) is not None
                }
                candidates = direct_candidates or trace_candidates or {
                    key for key in fallback_links.get(evidence.image_key, set())
                    if turns.get(key) is not None
                }
                if not candidates:
                    stats["evidence_unmatched"] += 1
                    continue
                for key in sorted(candidates):
                    located = turns[key]
                    if located is None:
                        continue
                    context, turn = located
                    bucket = grouped.setdefault(key, {
                        "context": context,
                        "turn": turn,
                        "evidences": {},
                    })
                    bucket["evidences"][evidence.image] = evidence.sample_value(
                        evidence.image_key in citations.get(key, set())
                    )
                    stats["evidence_associations"] += 1

    samples: list[dict[str, Any]] = []
    for (conversation_id, client_run_id), bucket in sorted(grouped.items()):
        context: ConversationContext = bucket["context"]
        turn: Turn = bucket["turn"]
        feedback = _feedback_for_turn(context, turn, client_run_id, catalog.feedback_rows)
        samples.append({
            "sample_id": _sample_id(conversation_id, client_run_id),
            "conversation_id": conversation_id,
            "client_run_id": client_run_id,
            "question": turn.question,
            "final_answer": turn.final_answer,
            "evidences": [bucket["evidences"][key] for key in sorted(bucket["evidences"])],
            "feedback": feedback,
            "label_status": derive_label_status(feedback),
        })

    _write_jsonl_atomic(output, samples)
    return {
        "schema_version": DATASET_SCHEMA_VERSION,
        "output": str(output),
        "sample_count": len(samples),
        "warnings": warnings,
        **stats,
    }
