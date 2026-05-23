# Deploy: opera-dist-alert-global

Serves global OPERA L3 DIST-ALERT (forest disturbance) tiles + click samples
for earthatlas.org/forestmonitor.

## One-time setup (on `earthatlas` project)

```bash
GCLOUD=/opt/homebrew/share/google-cloud-sdk/bin/gcloud
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.13

# 1. Link project to billing
$GCLOUD billing projects link earthatlas \
  --billing-account=0134BE-0792F2-3096CC

# 2. Enable APIs
$GCLOUD services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  earthengine.googleapis.com \
  --project=earthatlas

# 3. Register the project with Earth Engine (interactive, in browser):
#    https://code.earthengine.google.com/register
#    Pick "Use without a Cloud project" → No, then select earthatlas.
```

`PROJECT` in `main.py` is already set to `earthatlas`.

## Deploy

```bash
cd cloud-functions/opera-dist-alert-global

$GCLOUD functions deploy opera-dist-alert-global \
  --project=earthatlas \
  --runtime=python312 \
  --region=us-west1 \
  --source=. \
  --entry-point=get_tiles \
  --trigger-http \
  --allow-unauthenticated \
  --memory=512MB \
  --timeout=60s
```

The deploy prints a URL like
`https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global`.

## Optional: USDA NASS Quick Stats API key

For US clicks, the cause inference can pull county-level tillage practice
data from USDA NASS to refine "burn vs harvest" calls. Without the key the
crop-aware logic still works, just without county-level refinement.

1. Register for a free key at <https://quickstats.nass.usda.gov/api>.
2. Re-deploy with the key set as an env var:

```bash
$GCLOUD functions deploy opera-dist-alert-global \
  --project=earthatlas \
  --runtime=python312 \
  --region=us-west1 \
  --source=. \
  --entry-point=get_tiles \
  --trigger-http \
  --allow-unauthenticated \
  --memory=512MB \
  --timeout=60s \
  --set-env-vars=NASS_API_KEY=YOUR_KEY_HERE
```

## Wire it up

Set in Vercel project env (and local `.env.local`):

```
VITE_FOREST_TILES_API_BASE=https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global
```

## Smoke test

```bash
# Tile URL (recency mode)
curl "https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global" | jq

# Point sample (somewhere with known recent disturbance)
curl "https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global?lat=-9.5&lng=-63.5" | jq

# Point sample with extras (cause inference + crop profile)
curl "https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global?lat=40.9&lng=-89.0&extras=1" | jq
```
