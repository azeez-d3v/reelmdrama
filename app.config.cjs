module.exports = ({config}) => {
  const version = process.env.REELM_BUILD_VERSION_NAME || config.version;
  const rawCode = process.env.REELM_BUILD_VERSION_CODE || String(config.android.versionCode);
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[1-9]\d*$/.test(rawCode) || Number(rawCode) > 2100000000) throw Error('Invalid native version override');
  const pilot = process.env.REELM_BUILD_PILOT === '1';
  if (process.env.REELM_BUILD_PILOT && !['0', '1'].includes(process.env.REELM_BUILD_PILOT)) throw Error('Invalid pilot override');
  return {...config, name:pilot?'Reelm Drama Pilot':config.name, version, scheme: pilot ? 'reelm-drama-pilot' : 'reelm-drama', android: {...config.android, package: pilot ? 'org.reelm.drama.pilot' : 'org.reelm.drama', versionCode: Number(rawCode)}};
};
