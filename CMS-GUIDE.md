# CryptoNav 管理后台使用指南

> 零基础也能用的网页后台，填表单就能管理项目、广告、推荐位。

---

## 它是什么

Decap CMS 是一个跑在你网站上的管理后台。部署完成后，你访问 `https://你的网站地址/admin` 就能看到管理界面，不需要写任何代码。

**你能在后台做的事：**

| 功能 | 说明 |
|------|------|
| 项目管理 | 添加/编辑/删除导航站上的项目（名称、网址、分类、标签等） |
| 广告管理 | 修改广告位内容、跳转链接、启用/停用 |
| 首页推荐 | 调整首页推荐项目、排序 |
| 价格 Ticker | 修改顶部滚动条显示的币种和价格 |

**改完点保存 → 自动推送到 GitHub → Cloudflare 自动重新部署 → 网站更新。全程不用碰代码。**

---

## 第 1 步：部署网站

先把网站部署到 Cloudflare Pages（参考 `DEPLOYMENT.md`），确保网站能正常访问。

---

## 第 2 步：创建 GitHub OAuth App

CMS 需要通过 GitHub 授权才能修改你仓库里的数据，需要创建一个 OAuth App：

1. 打开 https://github.com/settings/developers
2. 点击 **New OAuth App**
3. 填写：

   | 字段 | 填什么 |
   |------|--------|
   | Application name | `CryptoNav CMS` |
   | Homepage URL | `https://你的网站地址`（如 `https://cryptonav-xxx.pages.dev`） |
   | Authorization callback URL | `https://你的网站地址/callback` |

4. 点击 **Register**
5. 创建完成后，页面会显示 **Client ID**，把它复制下来
6. 点击 **Generate a new client secret**，生成 **Client Secret**，也复制下来

> 注意：Client Secret 只显示一次，请马上复制保存。

---

## 第 3 步：部署 OAuth 代理（免费，用 Cloudflare Workers）

CMS 需要一个 OAuth 代理来处理 GitHub 授权流程。我们用 Cloudflare Workers 免费搭建：

1. 打开 https://dash.cloudflare.com/
2. 左侧菜单点 **Workers & Pages** → **Create** → **Create Worker**
3. 名字随便填（如 `cms-oauth`），点 **Deploy**
4. 部署后点 **Edit code**
5. 把以下代码粘贴进去（**全部替换**）：

```javascript
// CryptoNav CMS OAuth 代理（Cloudflare Worker）
// 处理 Decap CMS 的完整 GitHub OAuth 流程
// /api/auth     → 重定向到 GitHub 授权页
// /api/callback → 接收 code，换取 token，通过 postMessage 传回 CMS

const CLIENT_ID = "Ov23liNURTgjR3zrC76V";

function renderCallback(status, content) {
  // 返回一个 HTML 页面，通过 window.opener.postMessage 把 token 传回 CMS 弹出窗口
  return `<script>
    const receiveMessage = (message) => {
      window.opener.postMessage(
        'authorization:github:${status}:${JSON.stringify(content).replace(/'/g, "\\'")}',
        message.origin
      );
      window.removeEventListener("message", receiveMessage, false);
    }
    window.addEventListener("message", receiveMessage, false);
    window.opener.postMessage("authorizing:github", "*");
  </script>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      });
    }

    // 路由 1: /api/auth — 重定向到 GitHub 授权页
    if (url.pathname === '/api/auth') {
      const redirectUrl = new URL('https://github.com/login/oauth/authorize');
      redirectUrl.searchParams.set('client_id', CLIENT_ID);
      redirectUrl.searchParams.set('redirect_uri', 'https://cryptonav.site/api/callback');
      redirectUrl.searchParams.set('scope', 'repo user');
      redirectUrl.searchParams.set('state', crypto.randomUUID());
      return Response.redirect(redirectUrl.href, 302);
    }

    // 路由 2: /api/callback — 用 code 换取 token，返回 HTML 通过 postMessage 传回 CMS
    if (url.pathname === '/api/callback') {
      const code = url.searchParams.get('code');
      if (!code) {
        return new Response(renderCallback('error', { error: 'missing code' }), {
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
            client_id: CLIENT_ID,
            client_secret: env.OAUTH_CLIENT_SECRET,
            code,
          }),
        });

        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
          return new Response(renderCallback('error', tokenData), {
            headers: { 'Content-Type': 'text/html;charset=UTF-8' },
            status: 401,
          });
        }

        // 成功：把 token 通过 postMessage 传回 CMS
        return new Response(
          renderCallback('success', { token: tokenData.access_token, provider: 'github' }),
          {
            headers: { 'Content-Type': 'text/html;charset=UTF-8' },
            status: 200,
          }
        );
      } catch (error) {
        return new Response(renderCallback('error', { error: error.message }), {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
          status: 500,
        });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
```

6. 点 **Save and deploy**
7. **添加环境变量**（关键步骤）：
   - 在 Worker 页面点击 **Settings** → **Variables**
   - 添加一个变量：
     - Variable name: `OAUTH_CLIENT_SECRET`
     - Value: `c5b7ff66533541a7f310bbb517730ba45f8094e4`（你的 GitHub OAuth Client Secret）
     - **勾选 Encrypt**（加密），然后点 **Save**

8. **更新 GitHub OAuth App 回调地址**：
   - 回到 https://github.com/settings/developers → 你的 OAuth App
   - 把 **Authorization callback URL** 改为：`https://cms-oauth.chriscaochunsheng.workers.dev/api/callback`
   - 点 **Update application**

9. 你的 Worker 地址为：`https://cms-oauth.chriscaochunsheng.workers.dev`

---

## 第 4 步：配置 CMS

回到你的代码仓库，编辑 `public/admin/config.yml`。

config 已经填好了，核心配置如下：

```yaml
backend:
  name: github
  repo: Chris123564s/cryptonav
  branch: main
  site_domain: https://cryptonav.site
  base_url: https://cryptonav.site
  auth_endpoint: https://cms-oauth.你的用户名.workers.dev/api/auth  # ← 改成你的 Worker 地址
```

> **注意**：`auth_endpoint` 指向 Worker 的 `/api/auth` 路由，点击 Login 时 CMS 会打开这个地址，Worker 会重定向到 GitHub 授权页。

改完后 push 到 GitHub：

```bash
git add .
git commit -m "feat: 添加管理后台配置"
git push
```

Cloudflare 会自动重新部署，1-2 分钟后即可使用。

---

## 第 5 步：登录后台

1. 打开 `https://你的网站地址/admin`
2. 点击 **Login with GitHub**
3. GitHub 授权后自动跳回 CMS 界面
4. 你会看到 4 个管理模块：

   ```
   📁 项目管理  → 点击进入后可看到所有项目，点击任意项目编辑，或点"添加项目"
   📁 广告管理  → 管理广告位内容
   📁 首页推荐  → 调整首页推荐项目
   📁 价格 Ticker → 修改滚动条数据
   ```

---

## 日常操作示例

### 添加一个新项目

1. 后台点 **项目管理**
2. 点右侧 **+ New** 按钮
3. 填写表单：
   - ID: `newproject`（英文唯一标识）
   - 项目名称: `新项目名称`
   - 分类: 选择对应分类（如"中心化交易所"）
   - 简介: 一段描述
   - 官网地址: `https://xxx.com`
   - 状态: `active`
4. 点 **Save** → 自动提交到 GitHub → 自动部署
5. 1-2 分钟后网站更新，新项目出现

### 修改广告

1. 后台点 **广告管理**
2. 点击要修改的广告位
3. 修改标题、链接等字段
4. 点 **Save** → 自动生效

### 调整推荐位

1. 后台点 **首页推荐**
2. 修改推荐项目 ID 和理由
3. 调整排序数字（1 最靠前）
4. 点 **Save**

---

## 注意事项

- **JSON 格式**：CMS 直接编辑 JSON 数组文件，保存时会自动格式化，不用担心格式问题
- **构建延迟**：每次保存后 Cloudflare 需要 1-2 分钟重新构建，不是即时生效
- **图片上传**：上传的图片会保存到 `public/images/uploads/` 目录
- **本地调试**：开发时可以在 `config.yml` 里取消注释 `local_backend: true`，用 `npx decap-server` 跑本地后端测试
- **权限控制**：默认所有有仓库写权限的 GitHub 用户都可以编辑，建议给运营人员设为仓库 Collaborator
