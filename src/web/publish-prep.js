// 发布状态页只读取汇总；唯一动作是核验后将已有专用窗口置前。
async function loadPreparePage(){return import('/static/prepare-page.js');}
async function vPrepare() {
  const params=new URLSearchParams(location.hash.split('?')[1]||'');
  if(params.get('format')==='video') {const {videoProjectPage,initVideoProject}=await import('/static/video-project.js');after=initVideoProject;return videoProjectPage(esc,logo);}
  const data=await api('/api/prep/status'),page=await loadPreparePage();
  after=()=>page.initPreparePage({esc,api,toast});
  return page.preparePage(esc,data);
}