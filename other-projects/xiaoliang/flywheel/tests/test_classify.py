import unittest

from flywheel.classify import skip_download


class SkipDownloadTests(unittest.TestCase):
    def test_tianzheng_zip_skipped(self) -> None:
        reason = skip_download(
            "天正T20V7.0暖通/天正T20V7.0暖通.zip",
            project_name="三院天正T20 V7.0",
            extension=".zip",
        )
        self.assertEqual(reason, "installer_archive")

    def test_project_zip_kept(self) -> None:
        self.assertIsNone(
            skip_download(
                "34#地块项目.zip",
                project_name="Desktop",
                extension=".zip",
            )
        )

    def test_exe_skipped(self) -> None:
        self.assertEqual(
            skip_download("Desktop/晓量-Setup-0.8.18.exe", extension=".exe"),
            "runtime_extension:.exe",
        )

    def test_dwg_kept(self) -> None:
        self.assertIsNone(skip_download("施工图/一层平面.dwg", extension=".dwg"))

    def test_pdf_kept(self) -> None:
        self.assertIsNone(
            skip_download("河北省审图要点/导则.pdf", extension=".pdf")
        )

    def test_cab_skipped(self) -> None:
        self.assertEqual(
            skip_download("天正T20V7.0建筑/data2.cab", extension=".cab"),
            "runtime_extension:.cab",
        )

    def test_xiaoliang_runtime_pak(self) -> None:
        self.assertEqual(
            skip_download("晓量xiaoliang/resources/app.pak", extension=".pak"),
            "runtime_extension:.pak",
        )

    def test_xiaoliang_uv_exe(self) -> None:
        self.assertEqual(
            skip_download("晓量xiaoliang/resources/uv/uv.exe", extension=".exe"),
            "runtime_extension:.exe",
        )

    def test_evidence_md_kept(self) -> None:
        self.assertIsNone(
            skip_download(
                ".xiaoliang/cad/evidence/child-1/evidence.md",
                extension=".md",
            )
        )

    def test_zip_in_tianzheng_project_skipped_even_if_generic_name(self) -> None:
        reason = skip_download(
            "payload.zip",
            project_name="三院天正T20 V7.0",
            extension=".zip",
        )
        self.assertEqual(reason, "installer_archive")

    def test_backslash_path_normalized(self) -> None:
        self.assertEqual(
            skip_download(r"foo\bar.dll", extension=".dll"),
            "runtime_extension:.dll",
        )


if __name__ == "__main__":
    unittest.main()
