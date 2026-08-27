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

CMS 需要一个 OAuth 代理来处理授权流程。我们用 Cloudflare Workers 免费搭建：

1. 打开 https://dash.cloudflare.com/
2. 左侧菜单点 **Workers & Pages** → **Create** → **Create Worker**
3. 名字随便填（如 `cms-oauth`），点 **Deploy**
4. 部署后点 **Edit code**
5. 把以下代码粘贴进去（替换全部内容）：

```javascript
export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const { client_id, client_secret, code, redirect_uri } = body;

      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id,
          client_secret,
          code,
          redirect_uri,
        }),
      });

      const tokenData = await tokenResponse.json();
      return new Response(JSON.stringify(tokenData), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
```

6. 点 **Save and deploy**
7. 记下你的 Worker 地址，格式为：`https://cms-oauth.你的用户名.workers.dev`

---

## 第 4 步：配置 CMS

回到你的代码仓库，编辑 `public/admin/config.yml`：

把第 6-9 行改成你自己的信息：

```yaml
backend:
  name: github
  repo: 你的GitHub用户名/cryptonav       # 改成你的仓库
  branch: main
  auth_type: oauth_request
  app_id: "你的Client_ID"                # 第 2 步拿到的 Client ID
```

同时在文件顶部添加 OAuth 代理地址：

```yaml
site_url: https://你的网站地址
backend:
  name: github
  repo: 你的GitHub用户名/cryptonav
  branch: main
  auth_type: oauth_request
  app_id: "你的Client_ID"
  proxy: https://cms-oauth.你的用户名.workers.dev/.netlify/functions/auth
```

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
