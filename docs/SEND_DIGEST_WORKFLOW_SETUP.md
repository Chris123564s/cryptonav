## 收尾：启用每周自动发信（workflow 推不上去的绕行方案）

**为什么绕**:当前 GitHub PAT 缺 `workflow` scope,GitHub 会拒绝任何往
`.github/workflows/` 推文件的请求(报错 *refusing to allow a Personal Access Token
to create or update workflow ... without `workflow` scope*)。这是 GitHub 的安全设计,
不是 bug。所以 workflow 文件改为手动在网页创建。

### 步骤（约 3 分钟）

1. 打开仓库 https://github.com/Chris123564s/cryptonav
2. 顶部 **Actions** 标签 → 若首次进入可能要点 "I understand my workflows, go ahead and enable them"
3. 左侧 **New workflow** → 找 "**set up a workflow yourself**"(在列表顶部)点 **Configure**
4. **文件名**填 `send-digest.yml`(把默认的 `main.yml` 改掉)
5. 把模板文件内容**整段**复制粘贴进去(覆盖编辑器里原有内容):
   - 直接复制点:
     https://raw.githubusercontent.com/Chris123564s/cryptonav/main/docs/send-digest-workflow.yml
   - ⚠️ 只复制 `---` 分隔线**之间**的 YAML(body),文件顶部那几行 `# ⚠️ 这是"内容模板"...`
     注释块是说明用的,可留可删但不影响运行
6. 右侧 **Commit changes** → commit 到 `main`
7. 回到 **Actions** 标签,应看到 **Send Newsletter Digest** 出现在左侧列表

### 验证

- 点进 **Send Newsletter Digest** → **Run workflow** → 手动跑一次(它同时是首次实发)
- 或等每周日 16:00 UTC 自动跑
- 前提:第 2 步的 5 个 GitHub Secrets 都已加好(特别是 `SUPABASE_SERVICE_KEY` 和 `RESEND_API_KEY`)

### 可选：彻底解掉"推不上去"的限制

若以后还想让我直接推 workflow 文件,需要一个带 **`workflow`** scope 的经典 PAT
(GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
→ Generate new token → 勾 **`workflow`** + **`repo`**)。拿到后交我存进
`~/.hermes/secrets/`,用完你立刻 revoke。
