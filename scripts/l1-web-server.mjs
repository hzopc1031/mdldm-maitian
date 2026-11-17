// 仅工作台 HTTP 服务；不载入 hub 的平台发布、守护或定时链路。
import '../src/l1-store.mjs';
import { startWeb } from '../src/web.mjs';
startWeb();
