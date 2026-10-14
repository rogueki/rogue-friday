"""Macht die pip-installierten CUDA-DLLs (cuBLAS/cuDNN) fuer CTranslate2 unter Windows auffindbar."""
import os
import pathlib
import site


def register() -> None:
    for sp in site.getsitepackages():
        nvidia = pathlib.Path(sp) / "nvidia"
        if not nvidia.is_dir():
            continue
        for bin_dir in nvidia.glob("*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ["PATH"]
