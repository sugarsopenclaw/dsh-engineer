from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from cadkernel._ids import sha256_file


@dataclass(frozen=True, slots=True)
class ConversionProvenance:
    converter: str
    converter_version: str
    source_sha256: str
    output_sha256: str
    coordinate_decimal_places: int | None
    command: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DwgConversionResult:
    source_path: str
    dxf_path: str
    provenance: ConversionProvenance


class DwgConverter(Protocol):
    def convert(self, source: Path, target: Path) -> DwgConversionResult: ...


@dataclass(frozen=True, slots=True)
class CommandDwgConverter:
    """Adapter for ODA, MLight export wrappers, or another explicit converter.

    Command items may contain ``{source}`` and ``{target}`` placeholders. Shell parsing
    is deliberately not used, which keeps paths and provenance unambiguous.
    """

    command: tuple[str, ...]
    name: str
    version: str
    coordinate_decimal_places: int | None = None
    timeout_seconds: float = 180.0

    def convert(self, source: Path, target: Path) -> DwgConversionResult:
        rendered = tuple(
            item.format(source=str(source.resolve()), target=str(target.resolve()))
            for item in self.command
        )
        completed = subprocess.run(
            rendered,
            check=False,
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds,
            shell=False,
        )
        if completed.returncode != 0:
            stderr = completed.stderr.strip()[-2000:]
            raise RuntimeError(f"{self.name} failed with exit {completed.returncode}: {stderr}")
        if not target.is_file() or target.stat().st_size == 0:
            raise RuntimeError(f"{self.name} did not create a non-empty DXF at {target}")
        return DwgConversionResult(
            source_path=str(source.resolve()),
            dxf_path=str(target.resolve()),
            provenance=ConversionProvenance(
                converter=self.name,
                converter_version=self.version,
                source_sha256=sha256_file(str(source)),
                output_sha256=sha256_file(str(target)),
                coordinate_decimal_places=self.coordinate_decimal_places,
                # Persist the stable argv template rather than the rendered
                # temporary target path; identical conversions must yield the
                # same adapter fingerprint across invocations.
                command=self.command,
            ),
        )


@dataclass(frozen=True, slots=True)
class AutoCADComConverter:
    """Optional Windows conversion route; pywin32 is loaded only when selected."""

    version: str = "installed-autocad"
    # Autodesk AcSaveAsType.ac2018_dxf. Callers can override for another release.
    save_as_type: int = 61

    def convert(self, source: Path, target: Path) -> DwgConversionResult:
        if os.name != "nt":
            raise RuntimeError("AutoCAD COM conversion is available only on Windows")
        try:
            import pythoncom  # type: ignore[import-not-found]
            import win32com.client  # type: ignore[import-not-found]
        except ImportError as error:
            raise RuntimeError("AutoCAD COM conversion requires the existing pywin32 sidecar runtime") from error

        pythoncom.CoInitialize()
        document = None
        opened_here = False
        try:
            application = win32com.client.GetActiveObject("AutoCAD.Application")
            source_resolved = str(source.resolve()).casefold()
            for candidate in application.Documents:
                if str(getattr(candidate, "FullName", "")).casefold() == source_resolved:
                    raise RuntimeError(
                        "Refusing to SaveAs a drawing already open in AutoCAD; "
                        "convert a closed source or an explicit copy instead"
                    )
            if document is None:
                document = application.Documents.Open(str(source.resolve()), True)
                opened_here = True
            document.SaveAs(str(target.resolve()), self.save_as_type)
        finally:
            if opened_here and document is not None:
                document.Close(False)
            pythoncom.CoUninitialize()
        if not target.is_file() or target.stat().st_size == 0:
            raise RuntimeError("AutoCAD SaveAs did not create a non-empty DXF")
        return DwgConversionResult(
            source_path=str(source.resolve()),
            dxf_path=str(target.resolve()),
            provenance=ConversionProvenance(
                converter="autocad-com-saveas",
                converter_version=self.version,
                source_sha256=sha256_file(str(source)),
                output_sha256=sha256_file(str(target)),
                coordinate_decimal_places=None,
            ),
        )


def convert_dwg(source: str | Path, target: str | Path, converter: DwgConverter) -> DwgConversionResult:
    source_path = Path(source)
    target_path = Path(target)
    if source_path.suffix.casefold() != ".dwg":
        raise ValueError("DWG conversion source must have a .dwg suffix")
    if target_path.suffix.casefold() != ".dxf":
        raise ValueError("DWG conversion target must have a .dxf suffix")
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if target_path.exists():
        raise FileExistsError(f"Refusing to overwrite existing conversion target: {target_path}")
    return converter.convert(source_path, target_path)
