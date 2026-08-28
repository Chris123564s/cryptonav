// Cloudflare Pages Function: /api/auth
// 重定向到 GitHub OAuth 授权页
// 环境变量: GITHUB_CLIENT_ID (在 Cloudflare Pages Settings → Environment variables 设置)

export async function onRequest(context) {
  const { request, env } = context;

  const client_id = env.GITHUB_CLIENT_ID || "Ov23liNURTgjR3zrC76V";

  const url = new URL(request.url);
  const redirectUrl = new URL('https://github.com/login/oauth/authorize');
  redirectUrl.searchParams.set('client_id', client_id);
  redirectUrl.searchParams.set('redirect_uri', url.origin + '/api/callback');
  redirectUrl.searchParams.set('scope', 'repo user');
  redirectUrl.searchParams.set('state', crypto.randomUUID());

  return Response.redirect(redirectUrl.href, 302);
}
