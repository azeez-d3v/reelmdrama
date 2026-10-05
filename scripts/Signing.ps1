# Requires PowerShell 7 on Windows. No key/password is copied into the build stage.
$ReelmLegacyCertificate='fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c'
function Assert-ReelmNoReparse([string]$Path) {
 $cursor=[IO.Path]::GetFullPath($Path)
 while($cursor){
  if((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Signing reparse path rejected'}
  $cursor=Split-Path $cursor -Parent
 }
}
function Set-ReelmPrivateAcl([string]$Path) {
 Assert-ReelmNoReparse $Path
 $item=Get-Item -LiteralPath $Path -Force
 $acl=if($item.PSIsContainer){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
 foreach($identity in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
  $rule=if($item.PSIsContainer){[Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{[Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','Allow')}
  $acl.AddAccessRule($rule)
 }
 Set-Acl -LiteralPath $Path -AclObject $acl
 Assert-ReelmPrivateAcl $Path
}
function Assert-ReelmPrivateAcl([string]$Path) {
 Assert-ReelmNoReparse $Path
 $acl=Get-Acl -LiteralPath $Path
 $user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
 if(!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user){throw 'Signing ACL owner/inheritance rejected'}
 foreach($rule in $rules){if($rule.IdentityReference.Value -notin @($user,'S-1-5-18') -or $rule.AccessControlType -ne 'Allow'){throw 'Signing ACL principal rejected'}}
 foreach($sid in @($user,'S-1-5-18')){if(!($rules | Where-Object { $_.IdentityReference.Value -eq $sid -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl })){throw 'Signing ACL access missing'}}
}
function Convert-ReelmSecretText([Security.SecureString]$Secret) {
 $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
 try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}
function Invoke-ReelmSecretTool {
 param([string]$FilePath,[string[]]$ArgumentList,[Security.SecureString]$Password)
 $start=[Diagnostics.ProcessStartInfo]::new($FilePath)
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 foreach($argument in $ArgumentList){$start.ArgumentList.Add($argument)}
 $start.Environment['REELM_SIGNING_PASSWORD']=Convert-ReelmSecretText $Password
 $process=[Diagnostics.Process]::new();$process.StartInfo=$start
 try{
  if(!$process.Start()){throw 'Signing child failed to start'}
  $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  return [PSCustomObject]@{ExitCode=$process.ExitCode;Stdout=$stdout.GetAwaiter().GetResult();Stderr=$stderr.GetAwaiter().GetResult()}
 }finally{$start.Environment.Remove('REELM_SIGNING_PASSWORD')|Out-Null;$process.Dispose()}
}
function Get-ReelmCertificate {
 param([string]$Keystore,[string]$Alias,[Security.SecureString]$Password,[string]$Keytool=(Get-Command keytool.exe -ErrorAction Stop).Source)
 $result=Invoke-ReelmSecretTool $Keytool @('-exportcert','-rfc','-keystore',$Keystore,'-alias',$Alias,'-storepass:env','REELM_SIGNING_PASSWORD') $Password
 if($result.ExitCode -ne 0){throw "Signing certificate export failed ($($result.ExitCode))"}
 $certificate=[Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem($result.Stdout)
 return [PSCustomObject]@{Sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($certificate.RawData)).ToLowerInvariant();Certificate=$certificate}
}
function Get-ReelmSigningMaterial {
 param([string]$SigningRoot=(Join-Path $env:LOCALAPPDATA 'Reelm\Signing'),[string]$Keytool=(Get-Command keytool.exe -ErrorAction Stop).Source)
 Assert-ReelmNoReparse $SigningRoot
 $keystore=Join-Path $SigningRoot 'reelm-release.p12';$secret=Join-Path $SigningRoot 'password.dpapi';$pinFile=Join-Path $SigningRoot 'certificate.sha256'
 foreach($file in @($SigningRoot,$keystore,$secret,$pinFile)){if(!(Test-Path -LiteralPath $file)){throw 'Missing signing material; run Initialize-ReleaseSigning.ps1 explicitly'};Assert-ReelmPrivateAcl $file}
 Assert-ReelmPrivateAcl (Split-Path $SigningRoot -Parent)
 if((Get-Item -LiteralPath $pinFile).Length -gt 128 -or (Get-Item -LiteralPath $secret).Length -gt 16KB -or (Get-Item -LiteralPath $keystore).Length -gt 1MB){throw 'Signing material size rejected'}
 $pin=(Get-Content -Raw -LiteralPath $pinFile).Trim()
 if($pin -cnotmatch '^[0-9a-f]{64}$' -or $pin -eq $ReelmLegacyCertificate){throw 'Invalid private signing pin'}
 $plain=$null;$credentials=$null;$password=$null;$accepted=$false
 try{
  $plain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($secret),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $credentials=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json
  if($credentials.version -ne 1 -or $credentials.alias -ne 'reelm-release' -or $credentials.certificateSha256 -cne $pin -or (Get-FileHash -LiteralPath $keystore -Algorithm SHA256).Hash.ToLowerInvariant() -cne $credentials.keystoreSha256){throw 'Altered signing material/pin rejected'}
  $password=ConvertTo-SecureString $credentials.password -AsPlainText -Force
  $public=Get-ReelmCertificate $keystore $credentials.alias $password $Keytool
  try{
   $rsa=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($public.Certificate)
   try{if($public.Sha256 -cne $pin -or !$rsa -or $rsa.KeySize -lt 3072 -or $public.Certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow){throw 'Private certificate pin/algorithm/validity rejected'}}finally{if($rsa){$rsa.Dispose()}}
  }finally{$public.Certificate.Dispose()}
  $accepted=$true
  return [PSCustomObject]@{Keystore=$keystore;Alias=$credentials.alias;Password=$password;CertificateSha256=$pin}
 }finally{if(!$accepted -and $password){$password.Dispose()};if($plain){[Array]::Clear($plain,0,$plain.Length)};if($credentials){$credentials.password=$null}}
}
function Get-ReelmLegacySigningMaterial {
 param([string]$Keystore,[string]$Keytool=(Get-Command keytool.exe -ErrorAction Stop).Source)
 Assert-ReelmNoReparse $Keystore
 if(!(Test-Path -LiteralPath $Keystore)){throw 'Missing existing legacy keystore; preserved without replacement'}
 $password=ConvertTo-SecureString 'android' -AsPlainText -Force
 $accepted=$false;$public=$null
 try{
  $public=Get-ReelmCertificate $Keystore 'androiddebugkey' $password $Keytool
  if($public.Sha256 -cne $ReelmLegacyCertificate){throw 'Legacy signing certificate mismatch'}
  $accepted=$true
  return [PSCustomObject]@{Keystore=[IO.Path]::GetFullPath($Keystore);Alias='androiddebugkey';Password=$password;CertificateSha256=$ReelmLegacyCertificate}
 }finally{if($public){$public.Certificate.Dispose()};if(!$accepted){$password.Dispose()}}
}
function Protect-ReelmRecoveryPayload([byte[]]$Payload,[Security.SecureString]$Password) {
 $salt=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$nonce=[Security.Cryptography.RandomNumberGenerator]::GetBytes(12)
 $text=Convert-ReelmSecretText $Password
 if($text.Length -lt 16){throw 'Recovery passphrase must contain at least 16 characters'}
 $key=[Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2($text,$salt,600000,[Security.Cryptography.HashAlgorithmName]::SHA256,32);$text=$null
 $cipher=[byte[]]::new($Payload.Length);$tag=[byte[]]::new(16);$aad=[Text.Encoding]::UTF8.GetBytes('Reelm Signing Recovery v1')
 $aes=[Security.Cryptography.AesGcm]::new($key,16)
 try{$aes.Encrypt($nonce,$Payload,$cipher,$tag,$aad);return (@{version=1;algorithm='AES-256-GCM';kdf='PBKDF2-SHA256';iterations=600000;salt=[Convert]::ToBase64String($salt);nonce=[Convert]::ToBase64String($nonce);tag=[Convert]::ToBase64String($tag);ciphertext=[Convert]::ToBase64String($cipher)}|ConvertTo-Json -Compress)}finally{$aes.Dispose();[Array]::Clear($key,0,$key.Length)}
}
function Unprotect-ReelmRecoveryPayload([string]$Backup,[Security.SecureString]$Password) {
 if([Text.Encoding]::UTF8.GetByteCount($Backup) -gt 1MB){throw 'Recovery input too large'}
 $value=$Backup|ConvertFrom-Json
 if($value.version -ne 1 -or $value.algorithm -cne 'AES-256-GCM' -or $value.kdf -cne 'PBKDF2-SHA256' -or $value.iterations -ne 600000){throw 'Recovery format rejected'}
 $salt=[Convert]::FromBase64String($value.salt);$nonce=[Convert]::FromBase64String($value.nonce);$tag=[Convert]::FromBase64String($value.tag);$cipher=[Convert]::FromBase64String($value.ciphertext)
 if($salt.Length -ne 32 -or $nonce.Length -ne 12 -or $tag.Length -ne 16){throw 'Recovery parameters rejected'}
 $text=Convert-ReelmSecretText $Password;$key=[Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2($text,$salt,600000,[Security.Cryptography.HashAlgorithmName]::SHA256,32);$text=$null
 $plain=[byte[]]::new($cipher.Length);$aes=[Security.Cryptography.AesGcm]::new($key,16)
 try{$aes.Decrypt($nonce,$cipher,$tag,$plain,[Text.Encoding]::UTF8.GetBytes('Reelm Signing Recovery v1'));return ,$plain}finally{$aes.Dispose();[Array]::Clear($key,0,$key.Length)}
}
