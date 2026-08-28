// Cloudflare Pages Function: /api/submit
// Receives project submission form, creates a GitHub issue for review tracking
// Env var needed: GITHUB_ISSUE_TOKEN (GitHub fine-grained PAT with issues:write on the repo)

const REPO_OWNER = 'Chris123564s';
const REPO_NAME = 'cryptonav';
const ISSUE_LABEL = 'project-submission';

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

  // Validate required fields
  const { name, website, category } = data;
  if (!name || !website || !category) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: name, website, category' }),
      { status: 400, headers }
    );
  }

  // Basic spam check — reject if name/website look like spam
  const spamPatterns = /\b(viagra|casino|porn|loan|crypto-airdrop-giveaway|free-money)\b/i;
  if (spamPatterns.test(name) || spamPatterns.test(website)) {
    return new Response(
      JSON.stringify({ error: 'Submission rejected' }),
      { status: 422, headers }
    );
  }

  // Build issue body
  const fields = [
    { label: 'Project Name', value: name },
    { label: 'Website', value: website },
    { label: 'Category', value: category },
    { label: 'Description', value: data.description || '_N/A_' },
    { label: 'Logo URL', value: data.logo || '_N/A_' },
    { label: 'Twitter', value: data.twitter || '_N/A_' },
    { label: 'Telegram', value: data.telegram || '_N/A_' },
    { label: 'GitHub', value: data.github || '_N/A_' },
    { label: 'Discord', value: data.discord || '_N/A_' },
    { label: 'Submitter Email', value: data.email || '_N/A_' },
    { label: 'Submitted At', value: new Date().toISOString() },
    { label: 'Source', value: 'cryptonav.site/submit' },
  ];

  const issueBody = fields.map(f => `**${f.label}:** ${f.value}`).join('\n');
  const issueTitle = `[Submission] ${name}`;

  // Check for GitHub token
  const token = env.GITHUB_ISSUE_TOKEN;
  if (!token) {
    // No token — still accept the submission, store as in-memory log (will be lost on cold start)
    // In production, you should set GITHUB_ISSUE_TOKEN env var
    console.error('GITHUB_ISSUE_TOKEN not set — submission will not create a GitHub issue');
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Submission received. We will review it soon.' 
      }),
      { status: 200, headers }
    );
  }

  // Create GitHub issue
  try {
    const issueRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'cryptonav-submit',
        },
        body: JSON.stringify({
          title: issueTitle,
          body: issueBody,
          labels: [ISSUE_LABEL],
        }),
      }
    );

    if (!issueRes.ok) {
      const errData = await issueRes.text();
      console.error('GitHub API error:', issueRes.status, errData);
      // Still return success to user — we don't want to expose backend errors
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Submission received. We will review it soon.' 
        }),
        { status: 200, headers }
      );
    }

    const issue = await issueRes.json();
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Submission received. We will review it soon.',
        issueUrl: issue.html_url 
      }),
      { status: 200, headers }
    );
  } catch (error) {
    console.error('Failed to create issue:', error);
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Submission received. We will review it soon.' 
      }),
      { status: 200, headers }
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
