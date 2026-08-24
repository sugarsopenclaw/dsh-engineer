from __future__ import annotations

from pathlib import Path

from cadkernel.contracts import stable_json_dumps

from cadtasks.agentview import export_task_store, write_menu
from cadtasks.binding import ProjectBinding, ProjectFactBundle
from cadtasks.capabilities import create_builtin_capability_registry
from cadtasks.cli.main import main
from cadtasks.coverage import task_coverage_report
from cadtasks.recipes import create_builtin_recipe_registry
from cadtasks.rules import create_builtin_rule_registry
from cadtasks.storage import TaskStore


def test_menu_cli_export_and_coverage_surface(
    project_binding: ProjectBinding,
    tmp_path: Path,
) -> None:
    binding_path = tmp_path / "binding.json"
    binding_path.write_text(
        project_binding.to_json(pretty=True),
        encoding="utf-8",
    )
    menu_dir = tmp_path / "menu"
    menu = write_menu(project_binding, menu_dir)
    assert menu.semantic_classes
    assert (menu_dir / "index.txt").is_file()
    assert (menu_dir / "menu.json").is_file()
    assert main(["menu", str(binding_path), "--out", str(tmp_path / "menu-cli")]) == 0

    request_path = tmp_path / "request.json"
    request_path.write_text(
        stable_json_dumps(
            {
                "task_type": "count",
                "target_class": "generic.SymbolicComponent",
                "project_id": project_binding.project_id,
                "quantity_bases": [
                    "drawing_occurrence",
                    "unique_tag",
                    "bom_declared",
                    "physical_instance",
                ],
                "output_contract": ["answer", "structured_table"],
            },
            pretty=True,
        ),
        encoding="utf-8",
    )
    task_root = tmp_path / "task-output"
    assert main(
        [
            "run",
            str(binding_path),
            str(request_path),
            "--output",
            str(task_root),
        ]
    ) == 0
    stores = tuple(path.parent for path in task_root.rglob("task.sqlite3"))
    assert len(stores) == 1
    assert TaskStore.verify(stores[0], binding=project_binding) == ()
    agent_dir = export_task_store(stores[0], tmp_path / "agentview")
    assert (agent_dir / "index.txt").is_file()
    assert (agent_dir / "claims").is_dir()
    assert (agent_dir / "gaps").is_dir()
    assert main(
        ["export", str(stores[0]), "--out", str(tmp_path / "agentview-cli")]
    ) == 0
    assert main(["highlights", str(stores[0]), "--pretty"]) == 0

    facts = ProjectFactBundle.load(project_binding)
    coverage = task_coverage_report(
        facts,
        capabilities=create_builtin_capability_registry(),
        recipes=create_builtin_recipe_registry(),
        rules=create_builtin_rule_registry(),
    )
    assert coverage.source_count == 1
    assert coverage.representation_count == len(facts.resolution_index)
    assert "schedule.row_segmentation" in coverage.intentional_gaps

