"""Package release notices and verified upstream sources in a reproducible ZIP."""

import sys
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo


def package(target: Path, files: list[Path]) -> None:
    entries = {}
    for path in files:
        name = f"corresponding-source/{path.name}" if path.is_absolute() else path.as_posix()
        if ".." in Path(name).parts or name in entries or not path.is_file():
            raise ValueError(f"Invalid or duplicate compliance entry: {path}")
        contents = path.read_bytes()
        if not contents:
            raise ValueError(f"Empty compliance entry: {path}")
        entries[name] = contents

    if not {"LICENSE", "THIRD_PARTY_NOTICES.md"} <= entries.keys():
        raise ValueError("The license and notices must accompany the release")

    with ZipFile(target, mode="x") as archive:
        for name, contents in sorted(entries.items()):
            entry = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, contents, compress_type=ZIP_STORED)

    with ZipFile(target) as archive:
        if archive.testzip() or set(archive.namelist()) != entries.keys():
            raise ValueError("Compliance ZIP verification failed")
        for name, contents in entries.items():
            if archive.read(name) != contents:
                raise ValueError(f"Compliance ZIP entry differs: {name}")


if __name__ == "__main__":
    package(Path(sys.argv[1]), [Path(name) for name in sys.argv[2:]])
