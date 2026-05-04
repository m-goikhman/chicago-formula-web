"""
Ensure the project root is available on sys.path so shared modules can be imported.
"""
from pathlib import Path
import sys


def ensure_project_root():
    resolved = Path(__file__).resolve()
    parents = resolved.parents
    if len(parents) >= 3:
        root = parents[2]
    else:
        root = parents[0]
    root_str = str(root)
    if root_str not in sys.path:
        sys.path.append(root_str)


# Execute on import so any module that imports bootstrap gains access.
ensure_project_root()


__all__ = ["ensure_project_root"]

