const fs = require('node:fs/promises');
const path = require('node:path');
const {withAndroidManifest, withDangerousMod} = require('expo/config-plugins');
const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
 <base-config cleartextTrafficPermitted="false" />
 <domain-config cleartextTrafficPermitted="true">
  <domain includeSubdomains="false">127.0.0.1</domain>
  <domain includeSubdomains="false">localhost</domain>
 </domain-config>
</network-security-config>
`;
module.exports = function withLoopbackNetworkSecurity(config) {
 config = withAndroidManifest(config, next => {
  const application = next.modResults.manifest.application?.[0];
  if (!application) throw new Error('Android application element required');
  application.$['android:usesCleartextTraffic'] = 'false';
  application.$['android:networkSecurityConfig'] = '@xml/drama_probe_network_security_config';
  // Opt-in TEST activity visibility only; does not unlock/remove the device keyguard.
  const activity = application.activity?.find(x => x.$['android:name'] === '.MainActivity');
  if (activity && process.env.EXPO_PUBLIC_AUTOMATION === '1') {
   activity.$['android:showWhenLocked'] = 'true';
   activity.$['android:turnScreenOn'] = 'true';
  }
  return next;
 });
 return withDangerousMod(config, ['android', async next => {
  const folder = path.join(next.modRequest.platformProjectRoot,'app','src','main','res','xml');
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'drama_probe_network_security_config.xml'),XML,'utf8');
  return next;
 }]);
};
