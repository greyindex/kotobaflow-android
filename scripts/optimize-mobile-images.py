import argparse
import json
from pathlib import Path

from PIL import Image


def main():
    parser = argparse.ArgumentParser(
        description="Create size-efficient WebP copies of textbook PNG artwork."
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--max-width", type=int, default=1600)
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--files", type=Path, required=True,
                        help="Explicit JSON array of referenced relative PNG paths")
    args = parser.parse_args()

    if not args.source.is_dir():
        raise SystemExit(f"Image source directory is missing: {args.source}")

    relative_files = json.loads(args.files.read_text(encoding="utf-8"))
    if not isinstance(relative_files, list) or not relative_files:
        raise SystemExit("Image allow-list is empty")
    source_root = args.source.resolve(strict=True)
    source_files = []
    for relative in sorted(set(relative_files)):
        parts = Path(relative).parts
        if (len(parts) != 2 or parts[0] not in ("XinBian1", "XinBian2", "XinBian3", "XinBian4")
                or not relative.endswith(".png") or "\\" in relative):
            raise SystemExit(f"Unexpected image input: {relative}")
        candidate = args.source / relative
        if candidate.resolve(strict=True).parent.parent != source_root:
            raise SystemExit(f"Image path escaped source: {relative}")
        source_files.append(candidate)
    if not source_files:
        raise SystemExit(f"No PNG images found in: {args.source}")

    source_bytes = 0
    output_bytes = 0
    resized = 0
    for source_path in source_files:
        relative_path = source_path.relative_to(args.source).with_suffix(".webp")
        output_path = args.output / relative_path
        output_path.parent.mkdir(parents=True, exist_ok=True)

        source_bytes += source_path.stat().st_size
        with Image.open(source_path) as opened:
            image = opened.convert("RGB")
            if image.width > args.max_width:
                target_height = round(image.height * args.max_width / image.width)
                image = image.resize(
                    (args.max_width, target_height), Image.Resampling.LANCZOS
                )
                resized += 1
            image.save(
                output_path,
                "WEBP",
                quality=args.quality,
                method=6,
            )
        output_bytes += output_path.stat().st_size

    reduction = 100 * (1 - output_bytes / source_bytes)
    print(
        "Optimized "
        f"{len(source_files)} textbook images to WebP "
        f"({source_bytes / 1024 / 1024:.1f} MB -> "
        f"{output_bytes / 1024 / 1024:.1f} MB, {reduction:.1f}% smaller; "
        f"{resized} resized)."
    )


if __name__ == "__main__":
    main()
