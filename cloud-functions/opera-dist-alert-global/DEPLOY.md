# Deploy: opera-dist-alert-global

Serves global OPERA L3 DIST-ALERT (forest disturbance) tiles + click samples
for earthatlas.org/forestmonitor.

## One-time setup (on earthatlas-forestmonitor project)

The project `earthatlas-forestmonitor` already exists but cannot be linked
to billing yet — Google's default per-billing-account project quota is
maxed. Once approved:

```bash
GCLOUD=/opt/homebrew/share/google-cloud-sdk/bin/gcloud
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.13

# 1. Link project to billing
$GCLOUD billing projects link earthatlas-forestmonitor \
  --billing-account=0134BE-0792F2-3096CC

# 2. Enable APIs
$GCLOUD services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  earthengine.googleapis.com \
  --project=earthatlas-forestmonitor

# 3. Register the project with Earth Engine (interactive, in browser):
#    https://code.earthengine.google.com/register
#    Pick "Use without a Cloud project" → No, then select earthatlas-forestmonitor.
```

Then change `PROJECT` in `main.py` from `salish-sea-property-mapper` to
`earthatlas-forestmonitor` and deploy.

## Deploy

```bash
cd cloud-functions/opera-dist-alert-global

$GCLOUD functions deploy opera-dist-alert-global \
  --project=earthatlas-forestmonitor \
  --runtime=python311 \
  --region=us-west1 \
  --source=. \
  --entry-point=get_tiles \
  --trigger-http \
  --allow-unauthenticated \
  --memory=512MB \
  --timeout=60s
```

The deploy prints a URL like
`https://us-west1-earthatlas-forestmonitor.cloudfunctions.net/opera-dist-alert-global`.

## Wire it up

Set in Vercel project env (and local `.env.local`):

```
VITE_FOREST_TILES_API_BASE=https://us-west1-earthatlas-forestmonitor.cloudfunctions.net/opera-dist-alert-global
```

## Smoke test

```bash
# Tile URL (recency mode)
curl "https://.../opera-dist-alert-global" | jq

# Point sample (somewhere with known recent disturbance)
curl "https://.../opera-dist-alert-global?lat=-9.5&lng=-63.5" | jq
```
