import { createHash } from "crypto";

// Environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const RIVET_CLOUD_TOKEN = process.env.RIVET_CLOUD_TOKEN!;
const RIVET_CLOUD_ENDPOINT = "https://cloud-api.rivet.dev";
const RIVET_ENGINE_ENDPOINT = process.env.RIVET_ENGINE_ENDPOINT || "https://api.rivet.dev";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN!;
const PR_NUMBER = process.env.PR_NUMBER!;
const BRANCH_NAME = process.env.BRANCH_NAME!;
const REPO_FULL_NAME = process.env.REPO_FULL_NAME!;
const RUN_ID = process.env.RUN_ID!;

const COMMENT_MARKER = "<!-- rivet-preview-status -->";

// Vercel project info (auto-detected)
let VERCEL_PROJECT_ID: string;
let VERCEL_TEAM_ID: string | undefined;
let VERCEL_PROJECT_NAME: string;
let VERCEL_TEAM_SLUG: string;

async function getVercelProjectInfo(): Promise<void> {
	// First, list all projects to find the one linked to this repo
	console.log(`Searching for Vercel project linked to: ${REPO_FULL_NAME}`);

	// Try searching with repo filter first
	let searchUrl = `https://api.vercel.com/v9/projects?repo=${encodeURIComponent(REPO_FULL_NAME)}`;
	console.log(`Trying: ${searchUrl}`);

	let searchResponse = await fetch(searchUrl, {
		headers: {
			Authorization: `Bearer ${VERCEL_TOKEN}`,
		},
	});

	let searchResult = await searchResponse.json();
	console.log(`Search result: ${JSON.stringify(searchResult).substring(0, 500)}`);

	// If no results, try listing all projects and filtering manually
	if (!searchResult.projects || searchResult.projects.length === 0) {
		console.log("No results with repo filter, listing all projects...");

		const listUrl = `https://api.vercel.com/v9/projects?limit=100`;
		const listResponse = await fetch(listUrl, {
			headers: {
				Authorization: `Bearer ${VERCEL_TOKEN}`,
			},
		});

		const listResult = await listResponse.json();
		console.log(`Found ${listResult.projects?.length || 0} projects`);

		// Find project with matching repo
		const matchingProject = listResult.projects?.find((p: any) => {
			const repoUrl = p.link?.repo;
			const repoName = p.link?.repoId;
			console.log(`Project: ${p.name}, repo: ${repoUrl || repoName || 'none'}`);
			return repoUrl === REPO_FULL_NAME ||
				   repoUrl === `https://github.com/${REPO_FULL_NAME}` ||
				   p.name === 'template-vercel';
		});

		if (matchingProject) {
			searchResult = { projects: [matchingProject] };
		}
	}

	if (!searchResult.projects || searchResult.projects.length === 0) {
		throw new Error(`No Vercel project found linked to GitHub repo: ${REPO_FULL_NAME}. Make sure the project is linked to this repo in Vercel.`);
	}

	const project = searchResult.projects[0];
	VERCEL_PROJECT_ID = project.id;
	VERCEL_PROJECT_NAME = project.name;
	VERCEL_TEAM_ID = project.accountId;

	console.log(`Found Vercel project: ${VERCEL_PROJECT_NAME} (${VERCEL_PROJECT_ID})`);

	// Get team/user slug for URL generation
	if (VERCEL_TEAM_ID) {
		// Try to get team info
		const teamResponse = await fetch(
			`https://api.vercel.com/v2/teams/${VERCEL_TEAM_ID}`,
			{
				headers: {
					Authorization: `Bearer ${VERCEL_TOKEN}`,
				},
			}
		);

		if (teamResponse.ok) {
			const team = await teamResponse.json();
			VERCEL_TEAM_SLUG = team.slug;
			console.log(`Found Vercel team: ${VERCEL_TEAM_SLUG}`);
		} else {
			// Not a team, get user info
			const userResponse = await fetch(
				`https://api.vercel.com/v2/user`,
				{
					headers: {
						Authorization: `Bearer ${VERCEL_TOKEN}`,
					},
				}
			);

			if (!userResponse.ok) {
				throw new Error(`Failed to get Vercel user info: ${userResponse.status}`);
			}

			const user = await userResponse.json();
			VERCEL_TEAM_SLUG = user.user?.username || user.username;
			console.log(`Found Vercel user: ${VERCEL_TEAM_SLUG}`);
		}
	} else {
		// No team, get user info
		const userResponse = await fetch(
			`https://api.vercel.com/v2/user`,
			{
				headers: {
					Authorization: `Bearer ${VERCEL_TOKEN}`,
				},
			}
		);

		if (!userResponse.ok) {
			throw new Error(`Failed to get Vercel user info: ${userResponse.status}`);
		}

		const user = await userResponse.json();
		VERCEL_TEAM_SLUG = user.user?.username || user.username;
		console.log(`Found Vercel user: ${VERCEL_TEAM_SLUG}`);
	}

	console.log(`Detected Vercel project: ${VERCEL_PROJECT_NAME}, team/user: ${VERCEL_TEAM_SLUG}`);
}

// Rivet Cloud API helpers
async function rivetCloudFetch(path: string, options: RequestInit = {}): Promise<any> {
	const url = `${RIVET_CLOUD_ENDPOINT}${path}`;
	console.log(`Rivet Cloud API: ${options.method || 'GET'} ${url}`);

	const response = await fetch(url, {
		...options,
		headers: {
			Authorization: `Bearer ${RIVET_CLOUD_TOKEN}`,
			"Content-Type": "application/json",
			...options.headers,
		},
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Rivet Cloud API error: ${response.status} ${text}`);
	}

	const result = await response.json();
	console.log(`Rivet Cloud API response: ${JSON.stringify(result).substring(0, 200)}`);
	return result;
}

// GitHub API helpers
async function findExistingComment(): Promise<number | null> {
	const response = await fetch(
		`https://api.github.com/repos/${REPO_FULL_NAME}/issues/${PR_NUMBER}/comments`,
		{
			headers: {
				Authorization: `token ${GITHUB_TOKEN}`,
				Accept: "application/vnd.github.v3+json",
			},
		}
	);
	const comments = await response.json();
	if (!Array.isArray(comments)) {
		console.log("Comments response:", comments);
		return null;
	}
	const existing = comments.find((c: any) => c.body?.includes(COMMENT_MARKER));
	return existing?.id ?? null;
}

async function updateComment(commentId: number | null, body: string): Promise<number> {
	const fullBody = `${COMMENT_MARKER}\n${body}`;

	if (commentId) {
		await fetch(
			`https://api.github.com/repos/${REPO_FULL_NAME}/issues/comments/${commentId}`,
			{
				method: "PATCH",
				headers: {
					Authorization: `token ${GITHUB_TOKEN}`,
					Accept: "application/vnd.github.v3+json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ body: fullBody }),
			}
		);
		return commentId;
	} else {
		const response = await fetch(
			`https://api.github.com/repos/${REPO_FULL_NAME}/issues/${PR_NUMBER}/comments`,
			{
				method: "POST",
				headers: {
					Authorization: `token ${GITHUB_TOKEN}`,
					Accept: "application/vnd.github.v3+json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ body: fullBody }),
			}
		);
		const data = await response.json();
		return data.id;
	}
}

// Vercel URL generation
function sanitizeBranchName(branch: string): string {
	return branch
		.replace(/\//, "-") // First slash to hyphen
		.replace(/\//g, "") // Remove remaining slashes
		.replace(/[^a-z0-9]/gi, "-") // Non-alphanumeric to hyphen
		.toLowerCase();
}

function generateVercelPreviewUrl(projectName: string, branch: string, teamSlug: string): string {
	const safeBranch = sanitizeBranchName(branch);
	const baseUrl = `${projectName}-git-${safeBranch}-${teamSlug}`;

	// Truncate if > 63 chars
	if (baseUrl.length > 63) {
		const hash = createHash("sha256")
			.update(`${branch}${projectName}`)
			.digest("hex")
			.substring(0, 6);
		const truncatedBase = baseUrl.substring(0, 63 - 7); // Leave room for -hash
		return `${truncatedBase}-${hash}.vercel.app`;
	}

	return `${baseUrl}.vercel.app`;
}

// Vercel API helpers
async function setVercelEnvVar(
	key: string,
	value: string,
	branch: string
): Promise<void> {
	const teamQuery = VERCEL_TEAM_ID ? `teamId=${VERCEL_TEAM_ID}` : "";

	// Check if env var exists for this branch
	const listResponse = await fetch(
		`https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env?${teamQuery}`,
		{
			headers: {
				Authorization: `Bearer ${VERCEL_TOKEN}`,
			},
		}
	);
	const { envs } = await listResponse.json();

	const existing = envs?.find(
		(e: any) =>
			e.key === key &&
			e.target?.includes("preview") &&
			e.gitBranch === branch
	);

	if (existing) {
		// Update existing
		await fetch(
			`https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env/${existing.id}?${teamQuery}`,
			{
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${VERCEL_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ value }),
			}
		);
	} else {
		// Create new
		await fetch(
			`https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?${teamQuery}`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${VERCEL_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					key,
					value,
					type: "encrypted",
					target: ["preview"],
					gitBranch: branch,
				}),
			}
		);
	}
}

// Rivet Engine API helper
async function configureRunner(
	endpoint: string,
	accessToken: string,
	namespace: string,
	vercelUrl: string
): Promise<void> {
	const response = await fetch(`${endpoint}/runner-configs/us-west-1?namespace=${namespace}`, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			datacenters: {
				"us-west-1": {
					serverless: {
						url: `https://${vercelUrl}/api/rivet`,
						headers: {},
						min_runners: 0,
						max_runners: 1000,
						slots_per_runner: 1,
						request_lifespan: 300,
						runners_margin: 0,
					},
				},
			},
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Failed to configure runner: ${response.status} ${text}`);
	}
}

// Main flow
async function main() {
	const runLogsUrl = `https://github.com/${REPO_FULL_NAME}/actions/runs/${RUN_ID}`;
	let commentId = await findExistingComment();
	const namespaceName = `pr-${PR_NUMBER}`;

	try {
		// Auto-detect Vercel project info
		await getVercelProjectInfo();

		// Step 1: Creating namespace
		commentId = await updateComment(
			commentId,
			`## Rivet Preview Environment\n\n⏳ **Creating Rivet namespace** \`${namespaceName}\`...`
		);

		// Get project/org info from token
		const { project, organization } = await rivetCloudFetch("/tokens/api/inspect");

		// Check if namespace exists, create if not
		let namespace: any;
		let engineNamespace: string;

		try {
			const { namespaces } = await rivetCloudFetch(`/projects/${project}/namespaces?org=${organization}&limit=100`);
			const existing = namespaces?.find((ns: any) => ns.name === namespaceName);

			if (existing) {
				// Get full namespace info with access details
				const { namespace: fullNs } = await rivetCloudFetch(`/projects/${project}/namespaces/${namespaceName}?org=${organization}`);
				namespace = fullNs;
				engineNamespace = namespace.access?.engineNamespaceName || namespaceName;
				console.log(`Namespace ${namespaceName} already exists, engineNamespace: ${engineNamespace}`);
			} else {
				// Create new namespace
				const result = await rivetCloudFetch(`/projects/${project}/namespaces?org=${organization}`, {
					method: "POST",
					body: JSON.stringify({
						name: namespaceName,
						displayName: `PR #${PR_NUMBER}`,
					}),
				});
				namespace = result.namespace;
				engineNamespace = namespace.access?.engineNamespaceName || namespaceName;
				console.log(`Created namespace ${namespaceName}, engineNamespace: ${engineNamespace}`);
			}
		} catch (e: any) {
			console.log(`Error listing namespaces, trying to create: ${e.message}`);
			// If list fails, try to create
			const result = await rivetCloudFetch(`/projects/${project}/namespaces?org=${organization}`, {
				method: "POST",
				body: JSON.stringify({
					name: namespaceName,
					displayName: `PR #${PR_NUMBER}`,
				}),
			});
			namespace = result.namespace;
			engineNamespace = namespace.access?.engineNamespaceName || namespaceName;
			console.log(`Created namespace ${namespaceName}, engineNamespace: ${engineNamespace}`);
		}

		// Create tokens (always create fresh ones)
		const { token: secretToken } = await rivetCloudFetch(
			`/projects/${project}/namespaces/${namespace.name}/tokens/secret?org=${organization}`,
			{
				method: "POST",
				body: JSON.stringify({ name: `${namespaceName}-runner-token` }),
			}
		);

		const { token: publishableToken } = await rivetCloudFetch(
			`/projects/${project}/namespaces/${namespace.name}/tokens/publishable?org=${organization}`,
			{ method: "POST", body: JSON.stringify({}) }
		);

		const { token: accessToken } = await rivetCloudFetch(
			`/projects/${project}/namespaces/${namespace.name}/tokens/access?org=${organization}`,
			{ method: "POST", body: JSON.stringify({}) }
		);

		console.log("Created tokens");

		// Step 2: Configure Vercel env vars
		commentId = await updateComment(
			commentId,
			`## Rivet Preview Environment\n\n✅ Namespace \`${namespaceName}\` ready\n\n⏳ **Configuring Vercel environment variables**...`
		);

		await setVercelEnvVar("RIVET_ENDPOINT", RIVET_ENGINE_ENDPOINT, BRANCH_NAME);
		await setVercelEnvVar("RIVET_NAMESPACE", engineNamespace, BRANCH_NAME);
		await setVercelEnvVar("RIVET_RUNNER_TOKEN", secretToken, BRANCH_NAME);
		await setVercelEnvVar("RIVET_PUBLISHABLE_TOKEN", publishableToken, BRANCH_NAME);

		console.log("Set Vercel env vars");

		// Step 3: Generate Vercel URL and configure runner
		const vercelUrl = generateVercelPreviewUrl(VERCEL_PROJECT_NAME, BRANCH_NAME, VERCEL_TEAM_SLUG);

		commentId = await updateComment(
			commentId,
			`## Rivet Preview Environment\n\n✅ Namespace \`${namespaceName}\` ready\n✅ Vercel environment configured\n\n⏳ **Configuring Rivet runner** for \`${vercelUrl}\`...`
		);

		await configureRunner(RIVET_ENGINE_ENDPOINT, accessToken, engineNamespace, vercelUrl);

		console.log("Configured runner");

		// Step 4: Success!
		const dashboardUrl = `https://hub.rivet.dev/projects/${project}/namespaces/${namespace.name}`;

		await updateComment(
			commentId,
			`## Rivet Preview Environment

🚀 **Preview is live!**

| Resource | Link |
|----------|------|
| Namespace | [\`${namespaceName}\`](${dashboardUrl}) |
| Vercel Preview | [${vercelUrl}](https://${vercelUrl}) |

### Environment Variables Set
- \`RIVET_ENDPOINT\` = \`${RIVET_ENGINE_ENDPOINT}\`
- \`RIVET_NAMESPACE\` = \`${engineNamespace}\`
- \`RIVET_RUNNER_TOKEN\` = \`sk_***\`
- \`RIVET_PUBLISHABLE_TOKEN\` = \`pk_***\`

> **Note:** The Vercel deployment may still be building. The preview URL will be available once the deployment completes.`
		);

		console.log("Done!");
	} catch (error: any) {
		console.error("Error:", error);

		await updateComment(
			commentId,
			`## Rivet Preview Environment

❌ **Failed to setup preview environment**

\`\`\`
${error.message || error}
\`\`\`

[View run logs](${runLogsUrl}) and report issues to the Rivet team.`
		);

		process.exit(1);
	}
}

main();
