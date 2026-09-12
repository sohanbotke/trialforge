// One-time credential migration. Never prints credentials or token responses.
import {readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {createSign} from 'node:crypto';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {firebaseConfig} from '../firebase-config.js';
const project='trywise-9f8e1',email=`trywise-nightly@${project}.iam.gserviceaccount.com`;
const directory=resolve(homedir(),'Library/Application Support/TryWise');
const keyPath=resolve(directory,'nightly-collector.json'),sessionPath=resolve(directory,'nightly-session.json');
async function prepare(){
  const existing=await lstat(sessionPath).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  if(existing){console.log('Scoped collector session already exists.');return;}
  const stat=await lstat(keyPath);if(!stat.isFile()||(stat.mode&0o077))throw new Error('Unsafe legacy credential permissions.');
  const key=JSON.parse(await readFile(keyPath,'utf8'));if(key.client_email!==email||key.project_id!==project)throw new Error('Unexpected legacy identity.');
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),now=Math.floor(Date.now()/1000);
  const unsigned=`${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:email,sub:email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+3600,uid:'trywise-nightly-collector',claims:{collector:true}})}`;
  const token=`${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key.private_key,'base64url')}`;
  const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${firebaseConfig.apiKey}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({token,returnSecureToken:true})});
  if(!response.ok)throw new Error(`Collector session creation failed (${response.status}).`);
  const data=await response.json();const claims=JSON.parse(Buffer.from(data.idToken.split('.')[1],'base64url').toString());
  if(claims.sub!=='trywise-nightly-collector'||claims.collector!==true||claims.aud!==project||!data.refreshToken)throw new Error('Unexpected session identity.');
  await writeFile(sessionPath,JSON.stringify({type:'firebase_collector',project_id:project,uid:claims.sub,refresh_token:data.refreshToken}),{mode:0o600,flag:'wx'});
  console.log('Collection-scoped Firebase session saved outside the repository. Legacy access has not yet been revoked.');
}
async function retire(){
  const saved=JSON.parse(await readFile(sessionPath,'utf8'));if(saved.uid!=='trywise-nightly-collector')throw new Error('Prepare the new session first.');
  const require=createRequire(import.meta.url),base=process.env.FIREBASE_TOOLS_DIR;
  if(!base)throw new Error('Set FIREBASE_TOOLS_DIR for one-time operator authentication.');
  const {requireAuth}=require(resolve(base,'lib/requireAuth.js'));
  const {getGlobalDefaultAccount,setActiveAccount}=require(resolve(base,'lib/auth.js'));
  const options={project,nonInteractive:true};setActiveAccount(options,getGlobalDefaultAccount());await requireAuth(options);
  const token=await require(resolve(base,'lib/apiv2.js')).getAccessToken();
  async function api(url,body){const response=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`Legacy access retirement failed (${response.status}).`);return response.json();}
  const root=`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
  const policy=await api(`${root}:getIamPolicy`,{options:{requestedPolicyVersion:3}});
  for(const binding of policy.bindings||[])binding.members=binding.members.filter(member=>member!==`serviceAccount:${email}`);
  policy.bindings=policy.bindings.filter(binding=>binding.members.length);
  await api(`${root}:setIamPolicy`,{policy});
  await api(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${email}:disable`,{});
  console.log('Legacy collector service account disabled and its project IAM binding removed. Old key file retained privately but no longer usable.');
}
try{if(process.argv.includes('--retire-legacy'))await retire();else await prepare();}catch(error){console.error(error.message);process.exitCode=1;}
