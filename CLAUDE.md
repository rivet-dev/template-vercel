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

Only 2 secrets needed - everything else is auto-detected:

- `RIVET_CLOUD_TOKEN` - Rivet Cloud API token
- `VERCEL_TOKEN` - Vercel API token (get from https://vercel.com/account/tokens)

The Vercel project ID, team ID, project name, and team slug are all auto-detected from the GitHub repository link.

### Optional Variables

- `RIVET_ENGINE_ENDPOINT` - Defaults to `https://api.rivet.dev`
