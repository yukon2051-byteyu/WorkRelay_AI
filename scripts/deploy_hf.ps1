# Hugging Face Spaces へ公開デモを送る。
# Hugging Face は画像などのバイナリファイルを通常の git では受け付けないため、
# 現在のコミットから docs（スクリーンショット）と生成できるデモ用Excelを除いた「1コミットだけ」の内容を送る。
# 使い方：  .\scripts\deploy_hf.ps1 -Remote hf
#   事前に  git remote add hf https://huggingface.co/spaces/<ユーザー名>/<Space名>  を設定しておく。
#   push 時に聞かれるパスワードには、Hugging Face のアクセストークン（write 権限）を入力する。
param([string]$Remote = "hf")
$ErrorActionPreference = "Stop"

$root = git rev-parse --show-toplevel
if (git -C $root status --porcelain) { throw "コミットしていない変更があります。先にコミットしてください。" }
git -C $root remote get-url $Remote | Out-Null

$work = Join-Path $env:TEMP ("workrelay-hf-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
git -C $root worktree add --detach $work HEAD | Out-Null
try {
    Push-Location $work
    git checkout --orphan hf-deploy | Out-Null
    git rm -r -q --cached docs "backend/app/demo_data/files/*.xlsx"
    Remove-Item -Recurse -Force docs
    Get-ChildItem backend/app/demo_data/files -Filter *.xlsx | Remove-Item -Force
    git commit -q -m ("Deploy from " + (git -C $root rev-parse --short HEAD))
    git push --force $Remote hf-deploy:main
    Write-Host "Hugging Face に送りました。Space のページでビルドの進み具合を確認してください。"
}
finally {
    Pop-Location
    git -C $root worktree remove --force $work
    git -C $root branch -D hf-deploy 2>$null | Out-Null
}
