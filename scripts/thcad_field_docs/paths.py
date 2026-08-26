"""Repo-relative locations for THCAD extract field docs."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_THCAD = REPO_ROOT / "dev-test" / "visualstudionetframework" / "out-thcad"
EXTRACTOR_CS = (
    REPO_ROOT
    / "dev-test"
    / "visualstudionetframework"
    / "ThcadExtractor"
    / "DrawingExtractor.cs"
)
CATALOG_DIR = REPO_ROOT / "docs" / "dev"
FIELD_DOC_DIR = REPO_ROOT / "docs" / "thcad-extract-fields"
FIELD_MD_DIR = FIELD_DOC_DIR / "fields"

CATALOG_FILES = (
    CATALOG_DIR / "2026-08-24-THCAD全量实体数据能拿到什么.md",
    CATALOG_DIR / "2026-08-24-THCAD抽取数据一览表.md",
    CATALOG_DIR / "2026-08-25-THCAD批量抽取与数据底座选型.md",
)

DRAWING_NAMES = (
    "5TBC.384.A110050.1_1",
    "5TBC.384.A110050.2_1",
    "5TBC.426.A110050.1_1",
    "5TBC.457.A110050.1_1",
    "5TBC.709.A110050.1_1",
    "5TBC.709.A110050.1_2",
    "8TBC.312.A110050.101_1",
)
