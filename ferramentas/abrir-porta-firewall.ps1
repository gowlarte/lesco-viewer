# Abre a porta do editor no firewall do Windows, para outros aparelhos da rede local
# alcancarem o tour.
#
# O servidor com --rede escuta em 0.0.0.0 e imprime os enderecos da LAN, mas o firewall
# do Windows bloqueia entrada por padrao: sem uma regra, os enderecos anunciados dao
# timeout em todo mundo e nada no console explica por que.
#
#   Num PowerShell COMO ADMINISTRADOR:
#     powershell -ExecutionPolicy Bypass -File ferramentas/abrir-porta-firewall.ps1
#
#   Para fechar quando terminar:
#     powershell -ExecutionPolicy Bypass -File ferramentas/abrir-porta-firewall.ps1 -Remover
#
# A regra fica restrita ao perfil Private e a LocalSubnet: nao abre nada em rede publica
# nem fora da sua faixa de IP. Precisa de administrador — regra de firewall e configuracao
# de sistema, e a elevacao e a confirmacao de que voce quer isso.

param(
  [int]$Porta = 4360,
  [switch]$Remover,
  # Nao tenta elevar sozinho; so imprime o que seria preciso rodar.
  [switch]$SemElevar
)

$ErrorActionPreference = 'Stop'
$nome = "Lesco Viewer $Porta"

function Sair($codigo) {
  Write-Host ''
  exit $codigo
}

$ident = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = (New-Object Security.Principal.WindowsPrincipal($ident)).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

# Regra de firewall exige administrador, e a janela do UAC e onde voce autoriza a mudanca.
# O script pede a elevacao em vez de so reclamar: assim o trabalho de quem usa e um
# comando e um clique, sem abrir PowerShell como administrador na mao.
if (-not $admin) {
  if ($SemElevar) {
    Write-Host ''
    Write-Host '  Precisa de administrador. O comando, num PowerShell elevado:' -ForegroundColor Yellow
    Write-Host ''
    Write-Host "    cd '$((Get-Location).Path)'" -ForegroundColor Cyan
    $linha = '    powershell -ExecutionPolicy Bypass -File ferramentas/abrir-porta-firewall.ps1'
    if ($Remover) { $linha = $linha + ' -Remover' }
    Write-Host $linha -ForegroundColor Cyan
    Sair 1
  }

  $acao = 'abrir'
  if ($Remover) { $acao = 'fechar' }
  Write-Host ''
  Write-Host "  Para $acao a porta $Porta e preciso administrador." -ForegroundColor Yellow
  Write-Host '  Vai aparecer a janela do UAC — aceite para continuar, recuse para cancelar.'
  Write-Host '  A janela nova fica aberta com o resultado.'

  $argumentos = @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', ('"' + $PSCommandPath + '"'), '-Porta', $Porta)
  if ($Remover) { $argumentos = $argumentos + '-Remover' }

  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argumentos | Out-Null
    Write-Host ''
    Write-Host '  Elevacao pedida. Siga na janela nova.' -ForegroundColor Green
    Sair 0
  } catch {
    Write-Host ''
    Write-Host '  Elevacao recusada ou cancelada. Nada foi alterado.' -ForegroundColor Yellow
    Write-Host '  Para ver o comando sem tentar elevar, rode com -SemElevar.'
    Sair 1
  }
}

$existente = Get-NetFirewallRule -DisplayName $nome -ErrorAction SilentlyContinue

if ($Remover) {
  if ($existente) {
    Remove-NetFirewallRule -DisplayName $nome
    Write-Host ''
    Write-Host "  Regra removida: $nome" -ForegroundColor Green
    Write-Host '  A porta voltou a ficar fechada para a rede.'
  } else {
    Write-Host ''
    Write-Host "  Nao existe regra chamada '$nome'. Nada a remover." -ForegroundColor Yellow
  }
  Sair 0
}

if ($existente) {
  Write-Host ''
  Write-Host "  A regra '$nome' ja existe." -ForegroundColor Yellow
  Write-Host '  Perfil: ' -NoNewline
  Write-Host $existente.Profile
} else {
  New-NetFirewallRule -DisplayName $nome -Direction Inbound -Protocol TCP `
    -LocalPort $Porta -Action Allow -Profile Private -RemoteAddress LocalSubnet | Out-Null
  Write-Host ''
  Write-Host "  Porta $Porta liberada para a rede local." -ForegroundColor Green
  Write-Host '  Restrita ao perfil Private e a LocalSubnet.'
}

# Uma regra de perfil Private nao vale nada se a rede em uso estiver marcada como Public.
# O Windows marca Public por padrao em conexao nova, e o sintoma seria identico a nao ter
# regra nenhuma: timeout em todos os aparelhos, console do servidor sem nada de errado.
$publicas = @(Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -ne 'Private' -and
  $_.NetworkCategory -ne 'DomainAuthenticated' })

if ($publicas.Count -gt 0) {
  Write-Host ''
  Write-Host '  ATENCAO: a rede em uso nao esta marcada como Private.' -ForegroundColor Yellow
  foreach ($r in $publicas) {
    Write-Host "    $($r.InterfaceAlias): $($r.NetworkCategory)"
  }
  Write-Host '  Com a rede em Public a regra acima nao se aplica e o resultado e o mesmo'
  Write-Host '  que nao ter regra. Ajuste em Configuracoes, Rede e Internet, Wi-Fi,'
  Write-Host '  propriedades da rede: mude de Publica para Privada.'
}

$ips = @(Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).Status -eq 'Up'
  } | Select-Object -ExpandProperty IPAddress)

if ($ips.Count -gt 0) {
  Write-Host ''
  Write-Host '  Suba o servidor e passe um destes enderecos:'
  Write-Host ''
  Write-Host '    npm run dev:vr' -ForegroundColor Cyan
  Write-Host ''
  foreach ($ip in $ips) {
    Write-Host "    https://$($ip):$Porta/" -ForegroundColor Cyan
  }
  Write-Host ''
  Write-Host '  O aviso de certificado nao confiavel e esperado: o certificado e seu e nao'
  Write-Host '  vem de uma autoridade. Aceitar e seguir.'
}

Write-Host ''
Write-Host '  Quando terminar os testes, feche a porta:'
Write-Host '    powershell -ExecutionPolicy Bypass -File ferramentas/abrir-porta-firewall.ps1 -Remover'
Sair 0
