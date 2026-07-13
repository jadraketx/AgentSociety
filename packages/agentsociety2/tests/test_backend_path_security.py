import os
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from fastapi import HTTPException

from agentsociety2.backend.path_security import (
    extract_zip_under,
    require_disjoint_copy_paths,
    resolve_under_root,
    resolve_workspace_root,
)
from agentsociety2.backend.services.custom.compatibility import (
    ensure_relative_to_workspace,
)


def test_workspace_root_is_fixed_by_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    sibling = tmp_path / "sibling"
    sibling.mkdir()
    monkeypatch.setenv("WORKSPACE_PATH", str(workspace))

    assert resolve_workspace_root(str(workspace)) == workspace.resolve()
    with pytest.raises(HTTPException, match="Workspace path is not allowed"):
        resolve_workspace_root(str(sibling))


def test_resolve_under_root_rejects_traversal(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    similar_prefix = tmp_path / "workspace-escape"
    similar_prefix.mkdir()

    with pytest.raises(HTTPException, match="Path escapes workspace root"):
        resolve_under_root(workspace, "..", "outside")
    with pytest.raises(HTTPException, match="Path escapes workspace root"):
        resolve_under_root(workspace, str(similar_prefix))


def test_resolve_under_root_handles_root_and_symlink_escape(tmp_path: Path) -> None:
    assert resolve_under_root(Path(os.path.abspath(os.sep)), "tmp").is_absolute()

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (workspace / "link").symlink_to(outside, target_is_directory=True)

    with pytest.raises(HTTPException, match="Path escapes workspace root"):
        resolve_under_root(workspace, "link", "file.txt")


def test_relative_workspace_path_rejects_similar_prefix(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    child = workspace / "custom" / "skill.py"
    child.parent.mkdir()
    child.touch()
    outside = tmp_path / "workspace-escape" / "skill.py"
    outside.parent.mkdir()
    outside.touch()

    assert ensure_relative_to_workspace(workspace, child) == os.path.join(
        "custom", "skill.py"
    )
    with pytest.raises(ValueError, match="Target path escapes workspace"):
        ensure_relative_to_workspace(workspace, outside)


def test_extract_zip_under_rejects_traversal(tmp_path: Path) -> None:
    archive_data = BytesIO()
    with ZipFile(archive_data, "w") as archive:
        archive.writestr("../outside.txt", "unsafe")
    archive_data.seek(0)

    with ZipFile(archive_data) as archive:
        with pytest.raises(HTTPException, match="Path escapes workspace root"):
            extract_zip_under(tmp_path / "destination", archive)


def test_extract_zip_under_rejects_absolute_path(tmp_path: Path) -> None:
    archive_data = BytesIO()
    with ZipFile(archive_data, "w") as archive:
        archive.writestr("/outside.txt", "unsafe")
    archive_data.seek(0)

    with ZipFile(archive_data) as archive:
        with pytest.raises(HTTPException, match="Path escapes workspace root"):
            extract_zip_under(tmp_path / "destination", archive)


@pytest.mark.parametrize(
    "source_suffix,dest_suffix",
    [("skill", "skill"), ("skill", "skill/copy"), ("skill/copy", "skill")],
)
def test_copy_paths_must_not_overlap(
    tmp_path: Path, source_suffix: str, dest_suffix: str
) -> None:
    source = tmp_path / source_suffix
    destination = tmp_path / dest_suffix

    with pytest.raises(HTTPException, match="Source and destination overlap"):
        require_disjoint_copy_paths(source, destination)
