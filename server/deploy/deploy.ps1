<#
.SYNOPSIS
  把 Promptary API 部署到阿里云服务器。

.DESCRIPTION
  服务器上没装 pnpm、内存也只有 1.6G，所以构建放在本地做，只把产物传上去，
  服务器那边用 npm 装两个生产依赖即可。

  刻意不传 .env：它只在首次部署时手工放一次，之后由服务器自己保管。
  每次部署都覆盖的话，线上配置迟早会被本地那份冲掉。

.PARAMETER SshHost
  ~/.ssh/config 里的主机别名。

.PARAMETER RemoteDir
  服务器上的部署目录。

.PARAMETER SkipTest
  跳过测试。只在应急回滚时用 —— 正常部署没有理由跳过。

.EXAMPLE
  pwsh server/deploy/deploy.ps1
#>
param(
  [string]$SshHost = 'aliyun',
  [string]$RemoteDir = '/srv/promptary-api',
  [switch]$SkipTest
)

$ErrorActionPreference = 'Stop'
# server/ 目录 —— 本脚本在 server/deploy/ 下
$serverDir = Split-Path -Parent $PSScriptRoot

function Invoke-Step {
  param([string]$Title, [scriptblock]$Action)
  Write-Output ""
  Write-Output "=== $Title ==="
  & $Action
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    throw "$Title 失败(退出码 $LASTEXITCODE),已中止"
  }
}

Invoke-Step "1/4 测试" {
  if ($SkipTest) {
    Write-Output "(已跳过)"
    return
  }
  Push-Location $serverDir
  try { pnpm test } finally { Pop-Location }
}

Invoke-Step "2/4 构建" {
  Push-Location $serverDir
  try { pnpm build } finally { Pop-Location }
}

Invoke-Step "3/4 上传产物" {
  scp -r "$serverDir/dist" "${SshHost}:${RemoteDir}/"
  scp "$serverDir/package.json" "${SshHost}:${RemoteDir}/package.json"
}

Invoke-Step "4/4 安装依赖并重启" {
  # 这里刻意不用 $( ) 命令替换:PowerShell 的转义字符是反引号而非反斜杠,
  # 写成 \$( ) 会被本地先展开 —— 结果是本机去执行 systemctl,而远程什么也没做
  ssh $SshHost @"
set -e
cd $RemoteDir
npm install --omit=dev --registry=https://registry.npmmirror.com --no-audit --no-fund
chown -R promptary:promptary $RemoteDir
systemctl restart promptary-api
sleep 3
systemctl is-active promptary-api
curl -s --max-time 8 http://127.0.0.1:8788/healthz
"@
}

Write-Output ""
Write-Output "部署完成。外网验证: curl https://img.aidingge.top/promptary/healthz"
