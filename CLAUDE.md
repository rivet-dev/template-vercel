# CLAUDE.md

## Important Domain Information

**ALWAYS use `rivet.dev` - NEVER use `rivet.gg`**

- API endpoint: `https://api.rivet.dev`
- Dashboard: `https://hub.rivet.dev`
- Documentation: `https://rivet.dev/docs`

The `rivet.gg` domain is deprecated and should never be used in this codebase.

## GitHub Action: Rivet Preview Environment

This repo contains a GitHub Action workflow (`.github/workflows/rivet-preview.yml`) that automatically:

1. Creates a Rivet namespace for each PR (`pr-{number}`)
2. Sets up Vercel environment variables for the preview branch
3. Configures the Rivet serverless runner to point to the Vercel preview URL

### Required Secrets

- `RIVET_CLOUD_TOKEN` - Rivet Cloud API token
- `VERCEL_TOKEN` - Vercel API token
- `VERCEL_ORG_ID` - Vercel team/org ID
- `VERCEL_PROJECT_ID` - Vercel project ID

### Optional Variables

- `RIVET_ENGINE_ENDPOINT` - Defaults to `https://api.rivet.dev`

The Vercel project name and team slug are auto-detected from the Vercel API.
