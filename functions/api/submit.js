// Cloudflare Pages Function: /api/submit
// Receives project submission form, appends to src/data/projects.json with status=pending
// Env var needed: GITHUB_ISSUE_TOKEN (GitHub fine-grained PAT with contents:write on the repo)

const REPO_OWNER = 'Chris123564s';
const REPO_NAME = 'cryptonav';
const FILE_PATH = 'src/data/projects.json';

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = ['https://cryptonav.site', 'https://www.cryptonav.site'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : 'https://cryptonav.site';

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOrigin,
  };

  // Parse JSON body
  let data;
  try {
    data = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
  }

  // ---- input hardening ------------------------------------------------------
  // Everything here lands in a file that gets committed to the repo, and that
  // commit triggers a production build. So a junk submission does not just cost
  // a bad row: it costs one of the 500 builds/month the Pages free plan allows.
  // Bounding the input is not rate limiting -- it just caps how much damage one
  // request can do.
  const MAX = { name: 80, website: 200, category: 40, logo: 200, description: 600, social: 100 };
  // Control characters are stripped, not rejected: a newline in `name` would
  // otherwise be interpolated straight into the commit message below.
  const str = (v, max) =>
    typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

  const { name, website, category } = data;
  const cleanName = str(name, MAX.name);
  const cleanWebsite = str(website, MAX.website);
  const cleanCategory = str(category, MAX.category);

  if (!cleanName || !cleanWebsite || !cleanCategory) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: name, website, category' }),
      { status: 400, headers }
    );
  }

  // http(s) only. Anything else -- "javascript:alert(1)" being the one that
  // matters -- would be stored verbatim and turn into a clickable link the
  // moment the entry is approved.
  let parsedWebsite;
  try {
    parsedWebsite = new URL(cleanWebsite);
  } catch {
    return new Response(
      JSON.stringify({ error: 'website must be a valid URL' }),
      { status: 400, headers }
    );
  }
  if (parsedWebsite.protocol !== 'http:' && parsedWebsite.protocol !== 'https:') {
    return new Response(
      JSON.stringify({ error: 'website must start with http:// or https://' }),
      { status: 400, headers }
    );
  }

  // Basic spam check
  const spamPatterns = /\b(viagra|casino|porn|loan|crypto-airdrop-giveaway|free-money)\b/i;
  if (spamPatterns.test(name) || spamPatterns.test(website)) {
    return new Response(
      JSON.stringify({ error: 'Submission rejected' }),
      { status: 422, headers }
    );
  }

  // Check for GitHub token
  const token = env.GITHUB_ISSUE_TOKEN;
  if (!token) {
    console.error('GITHUB_ISSUE_TOKEN not set');
    // The frontend prints `error` verbatim, so this text is what a project
    // team sees after filling in the form. A missing env var is our problem,
    // not theirs, and "contact admin" gives them nothing to act on -- send
    // them to the address that does work instead.
    return new Response(
      JSON.stringify({
        error:
          'Automatic submission is unavailable right now. Email the project details to contact@cryptonav.site and we will add it.',
      }),
      { status: 500, headers }
    );
  }

  const ghHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cryptonav-submit',
  };

  try {
    // 1. Get current file content + sha
    const fileRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}?ref=main`,
      { headers: ghHeaders }
    );

    if (!fileRes.ok) {
      console.error('Failed to fetch projects.json:', fileRes.status);
      return new Response(
        JSON.stringify({ error: 'Server error. Please try again later.' }),
        { status: 500, headers }
      );
    }

    const fileData = await fileRes.json();
    const sha = fileData.sha;
    const content = JSON.parse(atob(fileData.content));

    // 2. Build new project entry
    const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const slugName = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const newProject = {
      id: slugName,
      name: cleanName,
      logo: str(data.logo, MAX.logo),
      category: cleanCategory,
      tags: [],
      description: str(data.description, MAX.description),
      website: cleanWebsite,
      chains: (Array.isArray(data.chains) ? data.chains : [])
        .filter((c) => typeof c === 'string')
        .slice(0, 10)
        .map((c) => c.trim().slice(0, 40)),
      social: {
        twitter: str(data.twitter, MAX.social),
        telegram: str(data.telegram, MAX.social),
        discord: str(data.discord, MAX.social),
        github: str(data.github, MAX.social),
      },
      metrics: {},
      verified: false,
      audited: false,
      riskLevel: 'medium',
      featured: false,
      sponsored: false,
      status: 'pending',
      source: 'community-submit',
      addedAt: now,
    };

    // 3. Append to projects array
    if (!content.projects || !Array.isArray(content.projects)) {
      content.projects = [];
    }

    // Check for duplicate (by website or name)
    const exists = content.projects.some(
      p => p.website === cleanWebsite || p.id === slugName
    );
    if (exists) {
      return new Response(
        JSON.stringify({ error: 'This project has already been submitted.' }),
        { status: 409, headers }
      );
    }

    content.projects.push(newProject);

    // 4. Write back to GitHub
    const jsonStr = JSON.stringify(content, null, 2);
    const encoded = btoa(jsonStr);
    const updateRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
      {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify({
          message: `feat: add pending project "${cleanName}" via community submit`,
          content: encoded,
          sha: sha,
          branch: 'main',
        }),
      }
    );

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error('GitHub update error:', updateRes.status, errText);
      return new Response(
        JSON.stringify({ error: 'Server error. Please try again later.' }),
        { status: 500, headers }
      );
    }

    // 5. Return success
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Submission received. We will review it soon.',
      }),
      { status: 200, headers }
    );
  } catch (error) {
    console.error('Submit error:', error);
    return new Response(
      JSON.stringify({ error: 'Server error. Please try again later.' }),
      { status: 500, headers }
    );
  }
}

// Handle CORS preflight
export async function onRequestOptions(context) {
  const { request } = context;
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = ['https://cryptonav.site', 'https://www.cryptonav.site'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : 'https://cryptonav.site';

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
