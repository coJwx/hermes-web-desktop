"""Generate Windows/DPI icon frames from the checked-in 1024px master (Pillow required)."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
source = root / "src-tauri/icons/icon-master.png"
output = root / "src-tauri/icons/icon.ico"
sizes = (16, 20, 24, 28, 32, 40, 48, 60, 64, 72, 84, 96, 128, 192, 256)
with Image.open(source) as image:
    if image.width != image.height or image.width < max(sizes):
        raise ValueError("Desktop icon requires a square, high-resolution master")
    image.convert("RGBA").save(output, format="ICO", sizes=[(size, size) for size in sizes])
print(f"Generated {output} with sizes {sizes}")
