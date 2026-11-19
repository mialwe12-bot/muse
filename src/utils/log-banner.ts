import fs from 'node:fs';
import {readPackageSync} from 'read-pkg';

const deployedCommit = () => {
  try {
    return fs.readFileSync('.deployed-commit', 'utf8').trim();
  } catch {
    return undefined;
  }
};

const logBanner = () => {
  const {version} = readPackageSync();
  console.log([
    '========================================',
    '=============== ByteMusic ==============',
    '========================================',
    `basiert auf Muse ${version} von codetheweb (MIT-Lizenz)`,
    `Commit: ${process.env.COMMIT_HASH ?? deployedCommit() ?? 'unbekannt'}`,
  ].join('\n'));
  console.log('\n');
};

export default logBanner;
