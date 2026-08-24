import tempfile
import unittest
from pathlib import Path

from flywheel.layout import (
    build_tree,
    folder_name,
    safe_join,
    safe_segment,
    user_dir_name,
)


class LayoutTests(unittest.TestCase):
    def test_email_keeps_at_sign(self) -> None:
        self.assertEqual(user_dir_name("209612331@qq.com"), "209612331@qq.com")

    def test_email_strips_forbidden(self) -> None:
        self.assertEqual(user_dir_name('a<b>|c@x.com'), "a_b__c@x.com")

    def test_safe_segment(self) -> None:
        self.assertEqual(safe_segment('一层平面:A/B'), "一层平面_A_B")

    def test_folder_name_uses_id_prefix(self) -> None:
        name = folder_name("ad87e487-34-pad-count", "垫片数量?")
        self.assertTrue(name.startswith("ad87e487__"))
        self.assertNotIn("?", name)

    def test_safe_join_rejects_escape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(ValueError):
                safe_join(root, "../secret.txt")

    def test_safe_join_ok(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dest = safe_join(root, "a/b/c.dwg")
            self.assertTrue(str(dest).endswith(str(Path("a") / "b" / "c.dwg")))

    def test_tree_collects_parent_dirs(self) -> None:
        tree = build_tree(
            ["施工图/建筑/一层.dwg", "施工图/结构/梁.dwg", "README.md"],
            project_name="门卫室",
            root_name="门卫施工图",
        )
        self.assertEqual(tree["project_name"], "门卫室")
        self.assertIn("施工图", tree["directories"])
        self.assertIn("施工图/建筑", tree["directories"])
        self.assertTrue(tree["empty_dirs_unobserved"])
        self.assertEqual(tree["file_count"], 3)


if __name__ == "__main__":
    unittest.main()
