# First-party maintenance entry. CheckOnly is read-only. Restart is for Liu to run.
[CmdletBinding(SupportsShouldProcess=$true)]
param([switch]$CheckOnly,[switch]$Restart)
$ErrorActionPreference='Stop'
if($CheckOnly -and $Restart){throw 'Choose CheckOnly or Restart, not both.'}
$repo=(Get-Item -LiteralPath (Join-Path $PSScriptRoot '..')).FullName
$project=(Get-Item -LiteralPath (Join-Path $repo '..')).FullName
$node='D:\Infra Tools\nodejs\node.exe'
$launcher=Join-Path $project 'codex-tasks\migration\Start-Maitian.ps1'
$entry=Join-Path $repo 'scripts\l1-web-server.mjs'
$database=Join-Path $repo 'data\hub.db'
foreach($file in @($node,$launcher,$entry,$database)){if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw ('Missing required file: '+$file)}}
$tokens=$null;$parseErrors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($launcher,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Existing launcher failed PowerShell syntax validation.'}
foreach($rel in @('src/db.mjs','src/comment-service.mjs','src/comments-http.mjs','src/x-comment-executor.mjs','src/x-comment-dom.mjs','src/web/comment-page.js','src/publish-prep.mjs','src/publish-posts.mjs','src/prep-wechat.mjs','src/prep-wechat-run.mjs','src/platform-rules.mjs','src/prep-publication.mjs','src/prep-intake.mjs','src/prep-agent.mjs','src/l1-inspect.mjs','src/web.mjs','src/web/publish-prep.js','src/web/prepare-page.js','scripts/l1-submit-prep.mjs')) {
  & $node --check (Join-Path $repo $rel)
  if($LASTEXITCODE -ne 0){throw ('Node syntax validation failed: '+$rel)}
}
function Get-WorkbenchOwner {
  $listeners=@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction Stop)
  if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw 'Workbench listener identity is unclear.'}
  $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listeners[0].OwningProcess)
  if($owner.ExecutablePath -ine $node -or $owner.CommandLine -notmatch 'scripts[/\\]l1-web-server\.mjs'){throw 'Port 8787 is not the expected workbench entry.'}
  return $owner
}
function Assert-WorkbenchIdle {
  $status=Invoke-RestMethod 'http://127.0.0.1:8787/api/l1/status' -TimeoutSec 5
  $preparations=Invoke-RestMethod 'http://127.0.0.1:8787/api/prep' -TimeoutSec 5
  if($status.comments.running){throw 'A comment operation is running; no restart performed.'}
  try {$postState=Invoke-RestMethod 'http://127.0.0.1:8787/api/prep/posts' -TimeoutSec 5;if(@($postState.posts|Where-Object{$_.generation.state -eq 'running'}).Count){throw 'A manuscript generation is running; no restart performed.'}}catch {if($_.Exception.Response.StatusCode.value__ -ne 404){throw}}
  if(@($status.actions|Where-Object{!$_.done}).Count -or @($status.platforms.PSObject.Properties|Where-Object{$_.Value.state -eq 'running'}).Count){throw 'An account or collection action is running; no restart performed.'}
  $query=@'
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[2],{readOnly:true});
try {
 const rows=db.prepare('SELECT record FROM publish_preparations ORDER BY rowid DESC').all().map(row=>JSON.parse(row.record));
 const hasComments=db.prepare("SELECT 1 FROM sqlite_master WHERE name='comment_jobs' AND type='table'").get();
 const commentsRunning=hasComments?db.prepare("SELECT count(*) n FROM comment_jobs WHERE state='running'").get().n:0;
 console.log(JSON.stringify({running:rows.filter(row=>row.state==='running').length+commentsRunning,ids:rows.slice(0,30).map(row=>row.id)}));
} finally {db.close();}
'@
  $raw=$query | & $node --input-type=module - $database
  if($LASTEXITCODE -ne 0){throw 'Read-only database identity check failed.'}
  $dbState=$raw|ConvertFrom-Json
  if($dbState.running -ne 0){throw 'A preparation operation is running; no restart performed.'}
  if(@(Compare-Object @($dbState.ids) @($preparations.records|ForEach-Object{$_.id})).Count){throw 'The running service and expected database do not match.'}
}
$old=Get-WorkbenchOwner
Assert-WorkbenchIdle
$facts=[ordered]@{state='checked';restartPerformed=$false;oldPid=$old.ProcessId;oldCreatedAt=$old.CreationDate.ToString('o');entry=$entry;databaseMatched=$true;syntaxChecked=$true;idle=$true}
if(!$Restart){[pscustomobject]$facts|ConvertTo-Json;return}
if(!$PSCmdlet.ShouldProcess('Maitian loopback web service on 8787','Back up database and restart the verified workbench entry')){return}
$out=Join-Path $project 'evidence\publish-redesign-20261123'
[void](New-Item -ItemType Directory -Path $out -Force)
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$receipt=Join-Path $out ('maintenance-'+$stamp+'.json')
$facts.startedAt=(Get-Date).ToString('o')
try {
  $backup=Join-Path $out ('hub-before-'+$stamp+'.db')
  $backupCode=@'
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[2]);
try {db.prepare('VACUUM INTO ?').run(process.argv[3]);} finally {db.close();}
'@
  $backupCode | & $node --input-type=module - $database $backup
  if($LASTEXITCODE -ne 0){throw 'Consistent SQLite backup failed; no process was stopped.'}
  $facts.backup=$backup
  Assert-WorkbenchIdle
  $again=Get-WorkbenchOwner
  if($again.ProcessId -ne $old.ProcessId -or $again.CreationDate -ne $old.CreationDate){throw 'Workbench ownership changed; no restart performed.'}
  Stop-Process -Id $old.ProcessId -ErrorAction Stop
  for($n=0;$n -lt 20 -and (Get-Process -Id $old.ProcessId -ErrorAction SilentlyContinue);$n++){Start-Sleep -Milliseconds 250}
  $facts.oldExited=!(Get-Process -Id $old.ProcessId -ErrorAction SilentlyContinue)
  if(!$facts.oldExited){throw 'Old service exit was not confirmed; no new process was launched.'}
  $started=& $launcher -Port 8787
  $facts.launcherPid=$started.LauncherPID
  $facts.restartPerformed=$true
  $contract=$null
  for($n=0;$n -lt 40 -and !$contract;$n++) {
    try {$contract=Invoke-RestMethod 'http://127.0.0.1:8787/api/prep/contract' -TimeoutSec 2}catch {Start-Sleep -Milliseconds 250}
  }
  if(!$contract -or $contract.version -ne 4 -or (@($contract.publishPlatforms) -join ',') -ne 'x,xhs'){throw 'Publish contract was not confirmed (expect x,xhs). Do not repeat platform actions.'}
  $current=Get-WorkbenchOwner
  $facts.newPid=$current.ProcessId
  $facts.contractVersion=$contract.version
  $facts.homeStatus=[int](Invoke-WebRequest 'http://127.0.0.1:8787/' -UseBasicParsing -TimeoutSec 5).StatusCode
  $facts.state='updated'
} catch {
  $facts.state='failed';$facts.error=$_.Exception.Message
  throw
} finally {
  $facts.finishedAt=(Get-Date).ToString('o')
  [pscustomobject]$facts|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $receipt -Encoding UTF8
  [pscustomobject]$facts|ConvertTo-Json -Depth 5|Write-Output
}
