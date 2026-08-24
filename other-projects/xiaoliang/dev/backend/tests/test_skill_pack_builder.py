from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.services.skill_pack_builder import build_skill_pack_from_directory


class SkillPackBuilderTests(unittest.TestCase):
    def test_build_skill_pack_ignores_disallowed_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_dir = Path(temp_dir) / "frustum-box-foundation"
            references_dir = source_dir / "references"
            references_dir.mkdir(parents=True, exist_ok=True)

            (source_dir / "SKILL.md").write_text(
                "\n".join(
                    [
                        "---",
                        "name: frustum-box-foundation",
                        "description: 计算截头体体积",
                        "---",
                        "",
                        "# 锥形独立基础截头体",
                        "",
                        "读取截图并计算体积。",
                    ]
                ),
                encoding="utf-8",
            )
            (references_dir / "example.md").write_text("# example", encoding="utf-8")
            (references_dir / "config.json").write_text('{"ok": true}', encoding="utf-8")
            (references_dir / "script.py").write_text("print('skip')", encoding="utf-8")

            pack = build_skill_pack_from_directory(
                source_dir=source_dir,
                release_channel="stable",
                skill_pack_version="1.2.3",
                built_at=datetime(2026, 4, 23, 2, 0, 0, tzinfo=timezone.utc),
            )

            self.assertEqual(pack["pack_format_version"], 1)
            self.assertEqual(pack["skill_pack_version"], "1.2.3")
            self.assertEqual(len(pack["skills"]), 1)
            file_paths = [item["path"] for item in pack["skills"][0]["files"]]
            self.assertEqual(file_paths, ["references/config.json", "references/example.md", "SKILL.md"])
            self.assertTrue(pack["skill_pack_checksum"])
            self.assertEqual(pack["skills"][0]["name"], "锥形独立基础截头体")

    def test_rejects_frontmatter_name_that_does_not_match_slug(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_dir = Path(temp_dir) / "frustum-box-foundation"
            source_dir.mkdir(parents=True)
            (source_dir / "SKILL.md").write_text(
                "---\nname: wrong-name\ndescription: 错误示例\n---\n\n# Test\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "name 必须等于目录 slug"):
                build_skill_pack_from_directory(
                    source_dir=source_dir,
                    release_channel="stable",
                    skill_pack_version="1.0.0",
                )

if __name__ == "__main__":
    unittest.main()
