// L1 overview 不代表实时登录体检；空检查结果也不能视为全部成功。
function healthLights(h = {}) {
  if (!h || h.mode === 'l1') return '<span class="light warn">手动采集模式</span><span class="light warn">平台登录 未实时检查</span>';
  const values = Object.values(h.login || {});
  const known = values.length > 0, ok = known && values.every(v => v === 'ok');
  const checked = !!h.doctorDay && [new Date().toLocaleDateString('zh-CN'), new Date().toLocaleDateString('sv-SE')].includes(h.doctorDay);
  return `<span class="light ${h.daemon ? 'ok' : 'warn'}">守护进程 ${h.daemon ? '运行中' : '未确认运行'}</span><span class="light ${h.nas ? 'ok' : 'warn'}">NAS ${h.nas ? '已挂载' : '未确认'}</span><span class="light ${h.chrome ? 'ok' : 'warn'}">专用浏览器 ${h.chrome ? '在线' : '未确认'}</span><span class="light ${!known ? 'warn' : !ok ? 'bad' : checked ? 'ok' : 'warn'}">平台登录 ${!known ? '未实时检查' : !ok ? '有掉线' : checked ? '今日已检' : '今天还没检'}</span>`;
}
