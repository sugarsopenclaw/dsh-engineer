"""Extract ordered paragraphs and table cells from a DOCX without changing it.

The output is JSON Lines so downstream curation can retain stable, inspectable
source locators instead of copying prose without provenance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def paragraph_record(
    paragraph: Paragraph,
    *,
    source_name: str,
    source_sha256: str,
    block_index: int,
    paragraph_index: int,
) -> dict[str, Any]:
    return {
        "record_kind": "paragraph",
        "source_name": source_name,
        "source_sha256": source_sha256,
        "locator": {
            "block_index": block_index,
            "paragraph_index": paragraph_index,
        },
        "style": paragraph.style.name if paragraph.style is not None else None,
        "text": paragraph.text,
    }


def table_records(
    table: Table,
    *,
    source_name: str,
    source_sha256: str,
    block_index: int,
    table_index: int,
) -> Iterable[dict[str, Any]]:
    for row_index, row in enumerate(table.rows):
        for column_index, cell in enumerate(row.cells):
            yield {
                "record_kind": "table_cell",
                "source_name": source_name,
                "source_sha256": source_sha256,
                "locator": {
                    "block_index": block_index,
                    "table_index": table_index,
                    "row_index": row_index,
                    "column_index": column_index,
                },
                "text": "\n".join(p.text for p in cell.paragraphs),
            }


def extract(source: Path) -> Iterable[dict[str, Any]]:
    document = Document(source)
    source_hash = sha256(source)
    paragraph_index = 0
    table_index = 0

    yield {
        "record_kind": "document",
        "source_name": source.name,
        "source_sha256": source_hash,
        "locator": {},
        "core_properties": {
            "title": document.core_properties.title or None,
            "subject": document.core_properties.subject or None,
            "author": document.core_properties.author or None,
            "created": (
                document.core_properties.created.isoformat()
                if document.core_properties.created
                else None
            ),
            "modified": (
                document.core_properties.modified.isoformat()
                if document.core_properties.modified
                else None
            ),
        },
    }

    for block_index, block in enumerate(document.iter_inner_content()):
        if isinstance(block, Paragraph):
            yield paragraph_record(
                block,
                source_name=source.name,
                source_sha256=source_hash,
                block_index=block_index,
                paragraph_index=paragraph_index,
            )
            paragraph_index += 1
        elif isinstance(block, Table):
            yield {
                "record_kind": "table",
                "source_name": source.name,
                "source_sha256": source_hash,
                "locator": {
                    "block_index": block_index,
                    "table_index": table_index,
                },
                "row_count": len(block.rows),
                "column_count": max((len(row.cells) for row in block.rows), default=0),
            }
            yield from table_records(
                block,
                source_name=source.name,
                source_sha256=source_hash,
                block_index=block_index,
                table_index=table_index,
            )
            table_index += 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = args.source.resolve(strict=True)
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="\n") as stream:
        for record in extract(source):
            stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True))
            stream.write("\n")


if __name__ == "__main__":
    main()
