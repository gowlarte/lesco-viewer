# Gera o certificado autoassinado que o modo VR precisa.
#
# WebXR exige contexto seguro, e o headset e outro aparelho — em http://IP o
# navigator.xr nem existe. Este script cria um certificado para o IP atual da maquina
# e exporta em PFX, que o Node le direto. Nao ha conversao para PEM porque isso
# exigiria openssl, e este projeto nao instala nada.
#
#   powershell -ExecutionPolicy Bypass -File ferramentas/gerar-certificado.ps1
#
# Nao precisa de administrador: o certificado vai para o repositorio do usuario atual.
# Rode de novo se o IP da maquina mudar.

$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pasta = Join-Path $raiz 'cert'
$pfx = Join-Path $pasta 'lesco-viewer.pfx'
$arquivoSenha = Join-Path $pasta 'senha.txt'

if (-not (Test-Path $pasta)) { New-Item -ItemType Directory -Path $pasta | Out-Null }

# Somente adaptadores realmente operacionais. O Windows mantem o lease de uma placa
# desconectada na tabela de IP, e um certificado para aquele endereco seria inutil.
$ips = @(Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).Status -eq 'Up'
  } | Select-Object -ExpandProperty IPAddress)

if ($ips.Count -eq 0) {
  Write-Host ''
  Write-Host '  Nenhuma interface de rede ativa. Conecte o Wi-Fi antes de gerar.' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

$sans = @('DNS=localhost', 'IPAddress=127.0.0.1')
foreach ($ip in $ips) { $sans += "IPAddress=$ip" }
$extensao = "2.5.29.17={text}" + ($sans -join '&')

Write-Host ''
Write-Host '  Gerando certificado para:' -ForegroundColor Cyan
Write-Host "    localhost, 127.0.0.1, $($ips -join ', ')"

$cert = New-SelfSignedCertificate `
  -Subject 'CN=Lesco Viewer (desenvolvimento)' `
  -TextExtension $extensao `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -NotAfter (Get-Date).AddYears(2) `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -FriendlyName 'Lesco Viewer dev'

# Senha aleatoria, guardada ao lado. A pasta cert/ esta no .gitignore.
$bytes = New-Object 'System.Byte[]' 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$senha = [Convert]::ToBase64String($bytes)
$segura = ConvertTo-SecureString -String $senha -Force -AsPlainText

Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $segura | Out-Null
Set-Content -Path $arquivoSenha -Value $senha -Encoding utf8 -NoNewline

# O certificado fica no repositorio do usuario tambem; remover evita acumular um
# certificado novo a cada execucao. O PFX exportado e o que o servidor usa.
Remove-Item -Path ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '  Pronto.' -ForegroundColor Green
Write-Host "    $pfx"
Write-Host ''
Write-Host '  Suba o servidor em https:'
Write-Host '    npm run dev:vr'
Write-Host ''
Write-Host '  No headset, o navegador vai acusar certificado nao confiavel — e esperado,'
Write-Host '  o certificado e seu e nao vem de uma autoridade. Aceite o aviso e siga.'
Write-Host ''
