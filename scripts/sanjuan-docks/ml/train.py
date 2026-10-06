#!/usr/bin/env python3
"""Dock-footprint pilot: fine-tune a YOLO instance-segmentation model on the
OSM-labelled training crops from prepare_pilot.py.

    ~/.venvs/sanjuan-docks/bin/python scripts/sanjuan-docks/ml/train.py [--epochs 60]

Uses train_* (one OSM dock each, labelled with every OSM dock shape in view) and
negative_* tiles (shoreline, no dock); 15% held out for validation. Pilot tiles are
never used. Runs on the Mac GPU (MPS). Weights land in data/sanjuan-docks/ml/runs/.
"""
import argparse, os, random, shutil
from ultralytics import YOLO

ROOT = 'data/sanjuan-docks/ml'
DS = f'{ROOT}/dataset'

ap = argparse.ArgumentParser()
ap.add_argument('--epochs', type=int, default=60)
ap.add_argument('--model', default='yolo11s-seg.pt')  # or a previous round's best.pt to fine-tune
ap.add_argument('--name', default='pilot')
ap.add_argument('--with-review', action='store_true', help='also train on review/train_tiles.json (reviewed pilot tiles)')
args = ap.parse_args()

# YOLO wants images/{train,val} + labels/{train,val} side by side; link, don't copy.
# The original OSM-labelled crops and negatives only — test-area tiles (pilot_, westcott_, …)
# are unlabelled unless reviewed, and reviewed ones come in through --with-review.
ids = sorted(f[:-4] for f in os.listdir(f'{ROOT}/images') if f.endswith('.jpg') and f.startswith(('train_', 'negative_')))
if args.with_review:
    import json
    ids += json.load(open(f'{ROOT}/review/train_tiles.json'))['tiles']
random.seed(7)
random.shuffle(ids)
n_val = max(1, int(len(ids) * 0.15))
split = {'val': ids[:n_val], 'train': ids[n_val:]}
shutil.rmtree(DS, ignore_errors=True)
for part, members in split.items():
    for kind, ext in (('images', 'jpg'), ('labels', 'txt')):
        os.makedirs(f'{DS}/{kind}/{part}', exist_ok=True)
        for i in members:
            src = os.path.abspath(f'{ROOT}/{kind}/{i}.{ext}')
            if os.path.exists(src):
                os.symlink(src, f'{DS}/{kind}/{part}/{i}.{ext}')
with open(f'{DS}/docks.yaml', 'w') as f:
    f.write(f'path: {os.path.abspath(DS)}\ntrain: images/train\nval: images/val\nnames:\n  0: dock\n')
print(f"train {len(split['train'])} / val {len(split['val'])} tiles")

model = YOLO(args.model)
model.train(
    data=f'{DS}/docks.yaml', epochs=args.epochs, imgsz=640, batch=8, device='mps',
    project=os.path.abspath(f'{ROOT}/runs'), name=args.name, exist_ok=True,
    # Aerial imagery: any rotation/flip is a valid dock; colours vary with light and season.
    degrees=180, flipud=0.5, fliplr=0.5, hsv_v=0.3, mosaic=1.0, patience=20, plots=True,
)
print('best weights:', f'{ROOT}/runs/{args.name}/weights/best.pt')
