from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / "public" / "assets"
source = root / "source"
frames_dir = root / "frames"
frames_dir.mkdir(parents=True, exist_ok=True)

sequences = [
    ("idle.gif", "idle"),
    ("andando.gif", "walk"),
    ("correndo.gif", "run"),
    ("Animação de salto do ladino encapuzado.gif", "jump"),
]
preview = Image.new("RGB", (4 * 180, 4 * 180), "#252836")
draw = ImageDraw.Draw(preview)
for row, (filename, key) in enumerate(sequences):
    source_gif = Image.open(source / filename)
    frames = []
    for index in range(source_gif.n_frames):
        source_gif.seek(index)
        frames.append(source_gif.convert("RGBA").copy())
    cell = 128
    sheet = Image.new("RGBA", (cell * len(frames), cell))
    for index, frame in enumerate(frames):
        bounds = frame.getbbox()
        if bounds:
            frame = frame.crop(bounds)
        frame.thumbnail((cell - 12, cell - 12))
        normalized = Image.new("RGBA", (cell, cell))
        normalized.alpha_composite(frame, ((cell - frame.width) // 2, cell - frame.height))
        sheet.alpha_composite(normalized, (index * cell, 0))
        thumb = frame.copy()
        thumb.thumbnail((160, 160))
        x, y = index * 180, row * 180
        preview.paste(thumb, (x, y), thumb)
        draw.text((x + 4, y + 4), f"{key} {index}", fill="white")
    sheet.save(frames_dir / f"{key}.png")
    print(f"{key}: {len(frames)} frames, normalized to {cell}x{cell}")
run_source = Image.open(frames_dir / "run.png")
walk_source = Image.open(frames_dir / "walk.png")
run8 = Image.new("RGBA", (128 * 8, 128))
pose_order = [("run", 0), ("walk", 1), ("run", 1), ("walk", 3), ("run", 2), ("walk", 2), ("run", 3), ("walk", 0)]
for index, (kind, pose) in enumerate(pose_order):
    sheet = run_source if kind == "run" else walk_source
    run8.alpha_composite(sheet.crop((pose * 128, 0, (pose + 1) * 128, 128)), (index * 128, 0))
run8.save(frames_dir / "run8.png")
print("run: 8-frame cycle assembled from available run and walk poses")
preview.save(root / "contact.png")
