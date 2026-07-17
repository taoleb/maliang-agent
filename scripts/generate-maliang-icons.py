#!/usr/bin/env python3
"""Generate 马良 desktop/web icons from a source PNG (default: ./logo.png).

Pads the source to square, upscales to 1024x1024 (Lanczos), and writes:
  apps/desktop/assets/icon.png            (1024x1024)
  apps/desktop/public/apple-touch-icon.png (1024x1024)
  apps/desktop/assets/icon.ico            (16/24/32/48/64/128/256)
  web/public/favicon.ico                  (16/32/48)

For .icns (mac only — not needed for Windows builds), run separately:
  npx --yes png2icons apps/desktop/assets/icon.png apps/desktop/assets/icon -i

Re-run anytime with a higher-res source: python scripts/generate-maliang-icons.py path/to/hires.png
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else (ROOT / "logo.png")
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
FAV_SIZES = [16, 32, 48]
TARGET = 1024


def make_square_1024(src: Path) -> Image.Image:
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    m = max(w, h)
    canvas = Image.new("RGBA", (m, m), (0, 0, 0, 0))
    canvas.paste(im, ((m - w) // 2, (m - h) // 2), im)
    return canvas.resize((TARGET, TARGET), Image.Resampling.LANCZOS)


def main() -> int:
    if not SRC.exists():
        print(f"source not found: {SRC}", file=sys.stderr)
        return 1
    src_size = Image.open(SRC).size
    im = make_square_1024(SRC)
    print(f"source {SRC.name} {src_size} -> {im.size[0]}x{im.size[1]} square")
    outputs = [
        (ROOT / "apps/desktop/assets/icon.png", "PNG", None),
        (ROOT / "apps/desktop/public/apple-touch-icon.png", "PNG", None),
        (ROOT / "apps/desktop/assets/icon.ico", "ICO", ICO_SIZES),
        (ROOT / "web/public/favicon.ico", "ICO", FAV_SIZES),
    ]
    for path, fmt, sizes in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        if sizes:
            im.save(path, format=fmt, sizes=[(s, s) for s in sizes])
        else:
            im.save(path, format=fmt)
        print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")
    print("done. For .icns (mac): npx --yes png2icons apps/desktop/assets/icon.png apps/desktop/assets/icon -i")
    return 0


if __name__ == "__main__":
    sys.exit(main())
