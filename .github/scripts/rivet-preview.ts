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

	let searchResponse = await fetch(searchUrl, {
		headers: {
			Authorization: `Bearer ${VERCEL_TOKEN}`,
		},
	});

	let searchResult = await searchResponse.json();

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

		// Find project with matching repo or name
		const matchingProject = listResult.projects?.find((p: any) => {
			const repoUrl = p.link?.repo;
			return repoUrl === REPO_FULL_NAME ||
				   repoUrl === `https://github.com/${REPO_FULL_NAME}` ||
				   p.name === REPO_FULL_NAME.split('/')[1];
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

	return response.json();
}

// GitHub API helpers
async function getPrTitle(): Promise<string> {
	const response = await fetch(
		`https://api.github.com/repos/${REPO_FULL_NAME}/pulls/${PR_NUMBER}`,
		{
			headers: {
				Authorization: `token ${GITHUB_TOKEN}`,
				Accept: "application/vnd.github.v3+json",
			},
		}
	);
	const pr = await response.json();
	return pr.title || `PR #${PR_NUMBER}`;
}

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

// Get Vercel deployment URL for a branch (prefers stable branch alias over unique deployment URL)
async function getVercelDeploymentUrl(branch: string, maxWaitMs: number = 120000): Promise<string> {
	const teamQuery = VERCEL_TEAM_ID ? `teamId=${VERCEL_TEAM_ID}` : "";
	const startTime = Date.now();

	while (Date.now() - startTime < maxWaitMs) {
		const response = await fetch(
			`https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&${teamQuery}&limit=10`,
			{
				headers: {
					Authorization: `Bearer ${VERCEL_TOKEN}`,
				},
			}
		);

		const { deployments } = await response.json();

		// Find any deployment for this branch
		const branchDeployment = deployments?.find((d: any) =>
			d.meta?.githubCommitRef === branch
		);

		if (branchDeployment) {
			// Get deployment details to find the stable branch alias
			const detailResponse = await fetch(
				`https://api.vercel.com/v13/deployments/${branchDeployment.uid}?${teamQuery}`,
				{
					headers: {
						Authorization: `Bearer ${VERCEL_TOKEN}`,
					},
				}
			);

			const detail = await detailResponse.json();
			console.log(`Deployment aliases: ${JSON.stringify(detail.alias)}`);

			// Prefer the branch-specific alias (contains -git-) which stays stable across deploys
			const branchAlias = detail.alias?.find((a: string) =>
				a.includes("-git-") && a.includes(VERCEL_PROJECT_NAME)
			);

			if (branchAlias) {
				return branchAlias;
			}

			// Fall back to the unique deployment URL if no alias yet
			if (detail.url) {
				console.log("No branch alias found, using deployment URL");
				return detail.url;
			}
		}

		// Wait before polling again
		console.log("Waiting for Vercel deployment...");
		await new Promise(resolve => setTimeout(resolve, 5000));
	}

	throw new Error(`Timed out waiting for Vercel deployment for branch: ${branch}`);
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
			`| Status | Namespace | Actions |\n|--------|-----------|--------|\n| ⏳ Creating namespace... | \`${namespaceName}\` | - |`
		);

		// Get project/org info from token
		const { project, organization } = await rivetCloudFetch("/tokens/api/inspect");

		// Check if namespace exists, create if not
		let namespace: any;
		let engineNamespace: string;

		// Get PR title for display name (16 chars max per cloud API)
		const prTitle = await getPrTitle();
		const displayName = prTitle.substring(0, 16);

		try {
			const { namespaces } = await rivetCloudFetch(`/projects/${project}/namespaces?org=${organization}&limit=100`);
			// Match by namespace name pattern (starts with pr-{number}- since API adds suffix)
			const existing = namespaces?.find((ns: any) => ns.name.startsWith(`${namespaceName}-`));

			if (existing) {
				// Reuse existing namespace - fetch full details
				const { namespace: fullNs } = await rivetCloudFetch(`/projects/${project}/namespaces/${existing.name}?org=${organization}`);
				namespace = fullNs;
				engineNamespace = namespace.access?.engineNamespaceName || namespace.name;
				console.log(`Reusing existing namespace ${namespace.name}`);
			} else {
				// Create new namespace
				const result = await rivetCloudFetch(`/projects/${project}/namespaces?org=${organization}`, {
					method: "POST",
					body: JSON.stringify({
						name: namespaceName,
						displayName,
					}),
				});
				namespace = result.namespace;
				engineNamespace = namespace.access?.engineNamespaceName || namespace.name;
				console.log(`Created namespace ${namespace.name} (${displayName})`);
			}
		} catch (e: any) {
			console.log(`Error listing namespaces, trying to create: ${e.message}`);
			// If list fails, try to create
			const result = await rivetCloudFetch(`/projects/${project}/namespaces?org=${organization}`, {
				method: "POST",
				body: JSON.stringify({
					name: namespaceName,
					displayName,
				}),
			});
			namespace = result.namespace;
			engineNamespace = namespace.access?.engineNamespaceName || namespace.name;
			console.log(`Created namespace ${namespace.name} (${displayName})`);
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
		const dashboardUrl = `https://hub.rivet.dev/projects/${project}/namespaces/${namespace.name}?skipOnboarding=1`;
		commentId = await updateComment(
			commentId,
			`| Status | Namespace | Actions |\n|--------|-----------|--------|\n| ⏳ Configuring Vercel... | \`${displayName}\` | [Dashboard](${dashboardUrl}) |`
		);

		await setVercelEnvVar("RIVET_ENDPOINT", RIVET_ENGINE_ENDPOINT, BRANCH_NAME);
		await setVercelEnvVar("RIVET_NAMESPACE", engineNamespace, BRANCH_NAME);
		await setVercelEnvVar("RIVET_RUNNER_TOKEN", secretToken, BRANCH_NAME);
		await setVercelEnvVar("RIVET_PUBLISHABLE_TOKEN", publishableToken, BRANCH_NAME);

		console.log("Set Vercel env vars");

		// Step 3: Wait for Vercel deployment and configure runner
		commentId = await updateComment(
			commentId,
			`| Status | Namespace | Actions |\n|--------|-----------|--------|\n| ⏳ Waiting for Vercel... | \`${displayName}\` | [Dashboard](${dashboardUrl}) |`
		);

		const vercelUrl = await getVercelDeploymentUrl(BRANCH_NAME);
		console.log(`Got Vercel deployment URL: ${vercelUrl}`);

		commentId = await updateComment(
			commentId,
			`| Status | Namespace | Actions |\n|--------|-----------|--------|\n| ⏳ Configuring runner... | \`${displayName}\` | [Dashboard](${dashboardUrl}) |`
		);

		await configureRunner(RIVET_ENGINE_ENDPOINT, accessToken, engineNamespace, vercelUrl);

		console.log("Configured runner");

		// Step 4: Success!
		await updateComment(
			commentId,
			`| Status | Namespace | Actions |\n|--------|-----------|--------|\n| ✅ Ready | \`${displayName}\` | [Dashboard](${dashboardUrl}) |`
		);

		console.log("Done!");
	} catch (error: any) {
		console.error("Error:", error);

		await updateComment(
			commentId,
			`| Status | Namespace | Actions |\n|--------|-----------|--------|\n| ❌ Failed: ${(error.message || error).substring(0, 50)}... | - | [Logs](${runLogsUrl}) |`
		);

		process.exit(1);
	}
}

main();
