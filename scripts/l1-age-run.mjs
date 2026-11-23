import {DatabaseSync} from 'node:sqlite';
import {dbPath,readConfig} from '../src/l1-config.mjs';
import {l1Account} from '../src/l1-account.mjs';
import {collectAgeSamples,ageSamplingSchema} from '../src/l1-age-sampling.mjs';
import {collectX} from '../src/l1-x.mjs';
import {collectNative} from '../src/l1-native.mjs';
import {collectXhs} from '../src/l1-xhs.mjs';
import {collectWechat} from '../src/l1-wechat.mjs';

const plan=JSON.parse(process.argv[2]??'[]');
const config=readConfig(), platform=plan[0]?.platform, account=l1Account(config,platform);
const db=new DatabaseSync(dbPath);
try {
  db.exec(ageSamplingSchema);
  const saved=await collectAgeSamples({db,config,account,plan,collectX,collectNative,collectXhs,collectWechat});
  console.log(`同龄采样保存 ${saved}/${plan.length} 条实测。`);
  if(!saved)process.exitCode=1;
} catch(error) {console.error(error.message);process.exitCode=1;}
finally {db.close();}
