$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Invoke-NativeForStatus {
  param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string[]]$Arguments
  )
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $Executable @Arguments 2>$null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  return [PSCustomObject]@{ Output = @($output); ExitCode = $exitCode }
}

$ghExe = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
if (-not (Test-Path -LiteralPath $ghExe)) {
  $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $ghCommand) { throw 'GitHub CLI não foi encontrado.' }
  $ghExe = $ghCommand.Source
}

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
$gitExe = if ($gitCommand) { $gitCommand.Source } else { $null }
if (-not $gitExe) {
  $gitCandidates = @(
    (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
    (Join-Path $env:ProgramFiles 'Git\bin\git.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  if ($gitCandidates.Count -gt 0) { $gitExe = $gitCandidates[0] }
}
if (-not $gitExe) {
  throw 'Git não foi encontrado. Instale o Git for Windows (https://git-scm.com/download/win), feche e reabra o PowerShell, depois execute este script novamente.'
}

$authStatus = Invoke-NativeForStatus $ghExe @('auth', 'status', '--hostname', 'github.com')
if ($authStatus.ExitCode -ne 0) {
  throw 'O GitHub CLI não está autenticado nesta sessão do Windows. Rode gh auth login e tente novamente.'
}

$ownerResult = Invoke-NativeForStatus $ghExe @('api', 'user', '--jq', '.login')
$owner = ($ownerResult.Output -join '').Trim()
if ($ownerResult.ExitCode -ne 0 -or -not $owner) { throw 'Não foi possível confirmar a conta autenticada do GitHub.' }
$accountIdResult = Invoke-NativeForStatus $ghExe @('api', 'user', '--jq', '.id')
$accountId = ($accountIdResult.Output -join '').Trim()
if ($accountIdResult.ExitCode -ne 0 -or -not $accountId) { throw 'Não foi possível confirmar o ID da conta autenticada.' }

$repoName = 'hoprise'
$repoSlug = "$owner/$repoName"
$repoUrl = "https://github.com/$repoSlug.git"
$repoView = Invoke-NativeForStatus $ghExe @('repo', 'view', $repoSlug, '--json', 'isPrivate,url')
$repoExists = $repoView.ExitCode -eq 0
if ($repoExists) {
  $repoInfo = ($repoView.Output -join "`n") | ConvertFrom-Json
  if (-not $repoInfo.isPrivate) {
    throw "O repositório existente $repoSlug é público. O script não enviará o projeto a um repositório público."
  }
}

$insideRepository = Invoke-NativeForStatus $gitExe @('rev-parse', '--is-inside-work-tree')
if ($insideRepository.ExitCode -ne 0 -or ($insideRepository.Output -join '').Trim() -ne 'true') {
  & $gitExe init --initial-branch=main
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível inicializar o repositório Git local.' }
}

$remoteResult = Invoke-NativeForStatus $gitExe @('remote', 'get-url', 'origin')
$currentRemote = ($remoteResult.Output -join '').Trim()
if ($remoteResult.ExitCode -eq 0 -and $currentRemote -ne $repoUrl) {
  throw "Já existe um destino origin diferente de $repoUrl. Nada foi enviado."
}

$branchResult = Invoke-NativeForStatus $gitExe @('branch', '--show-current')
if ($branchResult.ExitCode -ne 0) { throw 'Não foi possível ler a branch Git atual.' }
$currentBranch = ($branchResult.Output -join '').Trim()
if (-not $currentBranch) {
  $mainBranchExists = Invoke-NativeForStatus $gitExe @('show-ref', '--verify', '--quiet', 'refs/heads/main')
  if ($mainBranchExists.ExitCode -eq 0) {
    & $gitExe switch main
  } else {
    & $gitExe switch --create main
  }
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível selecionar ou criar a branch main.' }
} elseif ($currentBranch -ne 'main') {
  & $gitExe branch -M main
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar a branch main.' }
}

# Use GitHub's no-reply identity so a personal email is not added to the commit.
& $gitExe config user.name $owner
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível configurar o autor local do commit.' }
& $gitExe config user.email "$accountId+$owner@users.noreply.github.com"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível configurar o e-mail no-reply do commit.' }

npm run validate
if ($LASTEXITCODE -ne 0) { throw 'A validação do projeto falhou; o envio foi cancelado.' }

& $gitExe add --all
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar os arquivos. Verifique a permissão de escrita da pasta .git.' }

$stagedFiles = @(& $gitExe diff --cached --name-only)
$forbiddenFiles = @($stagedFiles | Where-Object {
  $_ -match '(^|/)(node_modules|dist|\.env(?:\.|$)|\.npmrc|local\.properties|key\.properties|android/app/src/main/assets/public/|ios/App/App/public/)' -or
  $_ -match '(?i)\.(?:pem|key|p12|pfx|jks|keystore|mobileprovision|provisionprofile)$' -or
  $_ -match '(?i)(?:GoogleService-Info\.plist|google-services\.json)$'
})
if ($forbiddenFiles.Count -gt 0) {
  $forbiddenFiles | ForEach-Object { Write-Output "Arquivo local/privado bloqueado: $_" }
  throw 'O envio foi cancelado porque a lista staged contém arquivos locais ou privados.'
}

& $gitExe diff --cached --quiet
if ($LASTEXITCODE -eq 1) {
  & $gitExe commit -m 'Initial HOPRISE project upload'
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o commit local.' }
} elseif ($LASTEXITCODE -ne 0) {
  throw 'Não foi possível verificar os arquivos preparados.'
}

if (-not $repoExists) {
  & $ghExe repo create $repoSlug --private --description 'HOPRISE vertical mobile game project'
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o repositório privado no GitHub.' }
}

$remoteResult = Invoke-NativeForStatus $gitExe @('remote', 'get-url', 'origin')
if ($remoteResult.ExitCode -ne 0) {
  & $gitExe remote add origin $repoUrl
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível configurar o destino GitHub.' }
}

& $gitExe push --set-upstream origin main
if ($LASTEXITCODE -ne 0) { throw 'O envio falhou. O commit local foi preservado para nova tentativa.' }
Write-Output "Projeto enviado com sucesso: https://github.com/$repoSlug"
