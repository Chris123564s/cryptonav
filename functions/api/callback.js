// Cloudflare Pages Function: /api/callback
// 接收 GitHub 回调的 code，换取 access_token，通过 postMessage 传回 CMS
// 环境变量: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET

function renderBody(status, content) {
  const json = JSON.stringify(content).replace(/</g, '\\u003c');
  return `<script>
    const receiveMessage = (message) => {
      window.opener.postMessage(
        'authorization:github:${status}:${json}',
        message.origin
      );
      window.removeEventListener("message", receiveMessage, false);
    }
    window.addEventListener("message", receiveMessage, false);
    window.opener.postMessage("authorizing:github", "*");
  </script>`;
}

export async function onRequest(context) {
  const { request, env } = context;

  const client_id = env.GITHUB_CLIENT_ID || "Ov23liNURTgjR3zrC76V";
  const client_secret = env.GITHUB_CLIENT_SECRET;

  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response(renderBody('error', { error: 'missing code' }), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      status: 400,
    });
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'cryptonav-cms-oauth',
      },
      body: JSON.stringify({
        client_id,
        client_secret,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return new Response(renderBody('error', tokenData), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        status: 401,
      });
    }

    return new Response(
      renderBody('success', { token: tokenData.access_token, provider: 'github' }),
      {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(renderBody('error', { error: error.message }), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      status: 500,
    });
  }
}
