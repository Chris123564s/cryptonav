"""
GitHub 仓库文件上传脚本
用法：python upload-to-github.py <GitHub_Token>

脚本会通过代理将项目所有文件上传到 GitHub 仓库。
"""

import os
import sys
import json
import base64
import urllib.request
import urllib.error
from pathlib import Path

# ===== 配置 =====
REPO_OWNER = "Chris123564s"
REPO_NAME = "cryptonav"
PROXY = "http://127.0.0.1:46310"
BRANCH = "main"

# 需要排除的文件/目录
EXCLUDE_DIRS = {"node_modules", ".git", "__pycache__", ".astro", "dist", ".workbuddy-ai"}
EXCLUDE_FILES = {"cryptonav-upload.zip", "cryptonav-files.zip", "upload-to-github.py"}


def api_request(method, path, token, data=None):
    """发送 GitHub API 请求"""
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/{path}"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "CryptoNav-Uploader",
    }
    body = json.dumps(data).encode("utf-8") if data else None

    proxy_handler = urllib.request.ProxyHandler({"https": PROXY, "http": PROXY})
    opener = urllib.request.build_opener(proxy_handler)

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = opener.open(req, timeout=30)
        return json.loads(resp.read().decode("utf-8")), resp.status
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        return json.loads(error_body) if error_body else {}, e.code
    except Exception as e:
        return {"error": str(e)}, 0


def get_file_sha(path, token):
    """获取文件当前的 SHA（用于更新已有文件）"""
    result, status = api_request("GET", f"contents/{path}?ref={BRANCH}", token)
    if status == 200 and "sha" in result:
        return result["sha"]
    return None


def upload_file(local_path, remote_path, token):
    """上传单个文件到 GitHub"""
    with open(local_path, "rb") as f:
        content = base64.b64encode(f.read()).decode("utf-8")

    sha = get_file_sha(remote_path, token)

    data = {
        "message": f"upload: {remote_path}",
        "content": content,
        "branch": BRANCH,
    }
    if sha:
        data["sha"] = sha

    result, status = api_request("PUT", f"contents/{remote_path}", token, data)

    if status in (200, 201):
        print(f"  ✅ {remote_path}")
        return True
    else:
        print(f"  ❌ {remote_path} (HTTP {status}): {result.get('message', 'unknown')}")
        return False


def main():
    if len(sys.argv) < 2:
        print("用法: python upload-to-github.py <GitHub_Token>")
        print("\n获取 Token 步骤:")
        print("1. 打开 https://github.com/settings/tokens/new")
        print("2. Note 填: cryptonav-upload")
        print("3. Expiration 选: 7 days")
        print("4. 勾选 repo 权限")
        print("5. 点 Generate token")
        print("6. 复制 token，粘贴到命令行")
        sys.exit(1)

    token = sys.argv[1].strip()
    if not token:
        print("Token 不能为空")
        sys.exit(1)

    # 收集所有要上传的文件
    project_dir = Path(__file__).parent
    files_to_upload = []

    for root, dirs, files in os.walk(project_dir):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for fname in files:
            if fname in EXCLUDE_FILES:
                continue
            filepath = os.path.join(root, fname)
            relpath = os.path.relpath(filepath, project_dir)
            # Windows 路径转 Unix 路径
            relpath = relpath.replace("\\", "/")
            files_to_upload.append((filepath, relpath))

    print(f"准备上传 {len(files_to_upload)} 个文件到 {REPO_OWNER}/{REPO_NAME}")
    print(f"代理: {PROXY}")
    print(f"分支: {BRANCH}")
    print()

    # 先验证 Token 是否有效
    result, status = api_request("GET", "", token)
    if status == 0 or "error" in result:
        print(f"❌ 无法连接到 GitHub API: {result.get('error', 'unknown')}")
        print("请检查代理是否开启")
        sys.exit(1)

    if status != 200:
        print(f"❌ Token 验证失败 (HTTP {status}): {result.get('message', '')}")
        sys.exit(1)

    print(f"✅ Token 有效，仓库: {result.get('full_name', '')}")
    print()

    # 先删除已有的 zip 文件
    sha = get_file_sha("cryptonav-upload.zip", token)
    if sha:
        print("删除旧的 zip 文件...")
        data = {"message": "delete: remove old zip", "sha": sha, "branch": BRANCH}
        api_request("DELETE", "contents/cryptonav-upload.zip", token, data)
        print("  ✅ 已删除 cryptonav-upload.zip")
        print()

    # 逐个上传文件
    success = 0
    failed = 0
    for local_path, remote_path in files_to_upload:
        if upload_file(local_path, remote_path, token):
            success += 1
        else:
            failed += 1

    print()
    print(f"上传完成: ✅ {success} 成功, ❌ {failed} 失败")
    print(f"仓库地址: https://github.com/{REPO_OWNER}/{REPO_NAME}")


if __name__ == "__main__":
    main()
