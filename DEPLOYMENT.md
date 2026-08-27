# CryptoNav 部署指南（Cloudflare Pages）

> 3 步上线，全程免费。

---

## 前置条件

- GitHub 账号
- Cloudflare 账号（免费注册 https://dash.cloudflare.com/）

---

## 第 1 步：代码推到 GitHub

```bash
# 在项目目录执行
git init
git add .
git commit -m "feat: CryptoNav 加密币导航站"

# 去 GitHub 新建一个仓库 cryptonav，然后：
git remote add origin https://github.com/你的用户名/cryptonav.git
git branch -M main
git push -u origin main
```

---

## 第 2 步：Cloudflare Pages 连接仓库

1. 登录 https://dash.cloudflare.com/
2. 左侧菜单点 **Workers & Pages**
3. 点 **Create** → **Pages** → **Connect to Git**
4. 授权 GitHub，选择 `cryptonav` 仓库
5. 填写构建设置：

| 设置项 | 填什么 |
|--------|--------|
| Framework preset | `Astro`（选了之后下面自动填好） |
| Build command | `npm run build` |
| Build output directory | `dist` |

6. 点 **Save and Deploy**
7. 等 1-2 分钟构建完成

部署成功后你会得到一个临时域名：`https://cryptonav-xxx.pages.dev`

访问它，确认网站正常。**到这一步网站就已经上线了。**

---

## 第 3 步：绑定自定义域名（可选）

如果你买了域名（比如 `cryptonav.com`）：

1. 进入 Pages 项目 → **Custom domains** → **Set up a custom domain**
2. 输入你的域名
3. 如果域名在 Cloudflare 管理 → 自动配置完成
4. 如果域名在其他注册商 → 添加一条 CNAME 记录：

   | 类型 | 名称 | 值 |
   |------|------|-----|
   | CNAME | `@` | `cryptonav-xxx.pages.dev` |
   | CNAME | `www` | `cryptonav-xxx.pages.dev` |

5. 等 5-30 分钟，SSL 证书自动签发，`https://你的域名` 就能访问了

---

## 日常更新

以后每次改了代码（比如新增项目、改广告），只需要：

```bash
git add .
git commit -m "update: 添加新项目"
git push
```

Cloudflare 自动检测到推送 → 自动构建 → 自动部署。不用任何手动操作。

---

## 域名注册推荐

| 注册商 | 价格 | 特点 |
|--------|------|------|
| Cloudflare Registrar | ≈$9/年 | 成本价，续费不涨价 |
| Namecheap | ≈$10/年 | 经常有优惠 |
| 阿里云 | ≈¥55/年 | 国内，需备案才能用国内 CDN |

建议直接在 Cloudflare 买域名，省去转入步骤，DNS 和 Pages 在同一个后台管理。

---

## 常见问题

**Q: 部署后页面白屏？**
A: 检查 Cloudflare 构建日志有没有报错。最常见的是依赖没装全，确认 `package.json` 里所有依赖都列了。

**Q: 搜索功能不工作？**
A: `public/data/projects.json` 文件必须存在。这个文件是给前端搜索用的，已在项目中包含。

**Q: 怎么加 Google Analytics？**
A: 在 `src/layouts/Layout.astro` 的 `<head>` 里加你的 GA 代码即可。

**Q: 免费额度够用吗？**
A: Cloudflare Pages 免费版：不限带宽、不限请求数、每月 500 次构建。对导航站来说完全够用。
