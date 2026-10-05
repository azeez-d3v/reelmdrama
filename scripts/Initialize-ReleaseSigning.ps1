[CmdletBinding()]
param(
 [string]$SigningRoot=(Join-Path $env:LOCALAPPDATA 'Reelm\Signing'),
 [string]$RecoveryFolder='D:\Sign-Android',
 [switch]$PromptRecoveryPassword,
 [Security.SecureString]$RecoveryPassword,
 [switch]$VerifyRecovery,
 [string]$Keytool=(Get-Command keytool.exe -ErrorAction Stop).Source
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Signing.ps1')
if(!$IsWindows -or $PSVersionTable.PSVersion.Major -lt 7){throw 'Windows PowerShell 7 required'}
$SigningRoot=[IO.Path]::GetFullPath($SigningRoot);$RecoveryFolder=[IO.Path]::GetFullPath($RecoveryFolder)
Assert-ReelmNoReparse $SigningRoot;Assert-ReelmNoReparse $RecoveryFolder
$backup=Join-Path $RecoveryFolder 'reelm-release.recovery.json'
if($PromptRecoveryPassword){
 $RecoveryPassword=Read-Host 'Recovery passphrase (at least 16 characters; retain independently)' -AsSecureString
 if(!$VerifyRecovery){
  $confirm=Read-Host 'Confirm recovery passphrase' -AsSecureString
  $first=Convert-ReelmSecretText $RecoveryPassword;$second=Convert-ReelmSecretText $confirm
  try{if($first -cne $second){throw 'Recovery passphrases differ'}}finally{$first=$null;$second=$null;$confirm.Dispose()}
 }
}
if($VerifyRecovery){
 if(!$RecoveryPassword){throw 'Use -PromptRecoveryPassword for local recovery validation'}
 Assert-ReelmPrivateAcl $RecoveryFolder;Assert-ReelmPrivateAcl $backup
 $plain=Unprotect-ReelmRecoveryPayload ([IO.File]::ReadAllText($backup)) $RecoveryPassword
 try{
  $payload=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json
  if($payload.version -ne 1 -or $payload.alias -ne 'reelm-release' -or $payload.certificateSha256 -cnotmatch '^[0-9a-f]{64}$'){throw 'Recovery payload rejected'}
  $key=[Convert]::FromBase64String($payload.keystore)
  if([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($key)).ToLowerInvariant() -cne $payload.keystoreSha256){throw 'Recovery key hash rejected'}
  # Compare authenticated recovery bytes to the existing signer; never restore over it.
  $material=Get-ReelmSigningMaterial $SigningRoot $Keytool
  try{
   if($material.CertificateSha256 -cne $payload.certificateSha256 -or (Get-FileHash -LiteralPath $material.Keystore -Algorithm SHA256).Hash.ToLowerInvariant() -cne $payload.keystoreSha256 -or (Convert-ReelmSecretText $material.Password) -cne $payload.password){throw 'Recovery does not match current signer'}
   Write-Output "RECOVERY_VERIFIED CERTIFICATE_SHA256=$($material.CertificateSha256)"
  }finally{$material.Password.Dispose()}
 }finally{[Array]::Clear($plain,0,$plain.Length);if($key){[Array]::Clear($key,0,$key.Length)};if($payload){$payload.password=$null;$payload.keystore=$null}}
 return
}
$keystore=Join-Path $SigningRoot 'reelm-release.p12';$secret=Join-Path $SigningRoot 'password.dpapi';$pinFile=Join-Path $SigningRoot 'certificate.sha256'
$existing=@(@($keystore,$secret,$pinFile)|Where-Object {Test-Path -LiteralPath $_})
if($existing.Count -gt 0 -and $existing.Count -ne 3){throw 'Inconsistent existing signer; preserved without replacement'}
if($existing.Count -eq 0){
 foreach($folder in @((Split-Path $SigningRoot -Parent),$SigningRoot)){
  if(!(Test-Path -LiteralPath $folder)){New-Item $folder -ItemType Directory|Out-Null}
  Set-ReelmPrivateAcl $folder
 }
 $free=(Get-PSDrive -Name ([IO.Path]::GetPathRoot($SigningRoot).Substring(0,1))).Free
 if($free -lt 20GB){throw 'Signing disk reserve below 20 GiB'}
 $password=ConvertTo-SecureString ([Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))) -AsPlainText -Force
 $plain=$null;$credentials=$null
 try{
  $generated=Invoke-ReelmSecretTool $Keytool @('-genkeypair','-noprompt','-alias','reelm-release','-keyalg','RSA','-keysize','3072','-sigalg','SHA256withRSA','-validity','10000','-storetype','PKCS12','-keystore',$keystore,'-storepass:env','REELM_SIGNING_PASSWORD','-keypass:env','REELM_SIGNING_PASSWORD','-dname','CN=Reelm Drama Release, O=Reelm, C=SG') $password
  if($generated.ExitCode -ne 0){throw "Private key creation failed ($($generated.ExitCode)); partial input preserved"}
  Set-ReelmPrivateAcl $keystore
  $public=Get-ReelmCertificate $keystore 'reelm-release' $password $Keytool
  try{
   if($public.Certificate.NotAfter.ToUniversalTime() -lt [DateTime]::UtcNow.AddYears(25)){throw 'New certificate validity below 25 years'}
   $credentials=@{version=1;alias='reelm-release';password=(Convert-ReelmSecretText $password);certificateSha256=$public.Sha256;keystoreSha256=(Get-FileHash -LiteralPath $keystore -Algorithm SHA256).Hash.ToLowerInvariant()}
   $plain=[Text.Encoding]::UTF8.GetBytes(($credentials|ConvertTo-Json -Compress))
   [IO.File]::WriteAllBytes($secret,[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser));Set-ReelmPrivateAcl $secret
   [IO.File]::WriteAllText($pinFile,$public.Sha256+"`n",[Text.UTF8Encoding]::new($false));Set-ReelmPrivateAcl $pinFile
  }finally{$public.Certificate.Dispose()}
 }finally{if($plain){[Array]::Clear($plain,0,$plain.Length)};if($credentials){$credentials.password=$null};$password.Dispose()}
}
$material=Get-ReelmSigningMaterial $SigningRoot $Keytool
try{
 $recoveryExported=$false
 if($RecoveryPassword){
  if(Test-Path -LiteralPath $backup){throw 'Existing encrypted recovery preserved; use -VerifyRecovery'}
  if(!(Test-Path -LiteralPath $RecoveryFolder)){New-Item $RecoveryFolder -ItemType Directory|Out-Null}
  Set-ReelmPrivateAcl $RecoveryFolder
  $key=[IO.File]::ReadAllBytes($material.Keystore)
  $payload=@{version=1;alias=$material.Alias;certificateSha256=$material.CertificateSha256;keystoreSha256=(Get-FileHash -LiteralPath $material.Keystore -Algorithm SHA256).Hash.ToLowerInvariant();keystore=[Convert]::ToBase64String($key);password=(Convert-ReelmSecretText $material.Password)}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Compress))
  try{
   $encrypted=Protect-ReelmRecoveryPayload $bytes $RecoveryPassword
   $recovered=Unprotect-ReelmRecoveryPayload $encrypted $RecoveryPassword
   if([Convert]::ToBase64String($bytes) -cne [Convert]::ToBase64String($recovered)){throw 'Recovery roundtrip failed'}
   [IO.File]::WriteAllText($backup,$encrypted+"`n",[Text.UTF8Encoding]::new($false));Set-ReelmPrivateAcl $backup
   # Reopen the saved ciphertext, not just the in-memory serialization.
   $saved=Unprotect-ReelmRecoveryPayload ([IO.File]::ReadAllText($backup)) $RecoveryPassword
   if([Convert]::ToBase64String($saved) -cne [Convert]::ToBase64String($bytes)){throw 'Saved recovery validation failed'}
   $recoveryExported=$true
  }finally{foreach($buffer in @($key,$bytes,$recovered,$saved)){if($buffer){[Array]::Clear($buffer,0,$buffer.Length)}};$payload.password=$null;$payload.keystore=$null}
 }
 Write-Output "PRIVATE_SIGNER_READY CERTIFICATE_SHA256=$($material.CertificateSha256) RECOVERY_EXPORTED=$recoveryExported"
}finally{$material.Password.Dispose()}
