# 客户端实施验收（2026-10-13）

阶段 apply，风险 strict。用户授权实施，只修改 web/。服务器、apps/shared、apps/desktop、tui_gateway 和 Rust 源码未修改。原先已暂存的仓库外 .workbuddy/memory 文件保持独立，未操作其内容或暂存状态。

## 实现与边界

- web-chat-workspace 拥有唯一逻辑 WS；shared GatewayClient 的现有 replay=false 选项关闭第二个恢复 owner。真正断线/安全回收创建新 channel 并释放旧内部序号索引；warm 选择不会创建连接。
- web-chat-session 是纯本地投递端，所有 JSON-RPC 仍经现有共享客户端。每个 controller 保留独立操作/正文；web-chat-session-events 提取原事件投影。未增加依赖或服务端契约。
- 关闭页签只释放本地历史；轻量绑定占容量，运行/请求会话保留后台入口。上限 16 包含 pending 和未知 create；拒绝任务中整连接回收。
- live-valid 有序补发；冷快照替换、可见活动会话每秒同步、有限终态校准。序号缺口/epoch/truncated/runtime失效不会伪造快照游标。
- 操作捕获会话与连接；断线后旧 responder 失效，model confirm 留在发起会话；秘密表单不持久化，离线/切视图清空。
- 保留历史/预览/缓冲、文本/File 草稿预算和 URL 所有权。控制请求高水位暂停新工作而保留请求，不自动拒绝。
- 已有 useUnsavedChanges 聚合隐藏草稿和短客户端事务；一个活动正文视图意味着后台 Markdown/media/tail 无独立挂载。未变更 Rust。

## 已执行证据

1. pnpm exec tsc -b：通过。
2. pnpm exec vitest run src/lib/web-chat src/pages/WebChatPage.test.tsx src/hooks/useWebChatImages.test.tsx src/lib/gatewayClient.test.ts：12 文件、41 项通过（最终复跑见 verification.yaml）。
3. pnpm exec vite build --outDir node_modules/.tmp/web-chat-multiplex-build：成功构建 2534 modules，输出仅在 web 内临时目录。
4. web-chat-workspace.test 复用真实 GatewayClient/JSON-RPC channel，包含 5 页签 100 次 warm 选择（选择引起的 dial/activate/resume/history/list 为 0）、后台隔离、延迟 ACK、预绑定请求、live/replay去重、冷 inflight竞争、16关联/回收、LRU与大行裁剪、<=2并发恢复、4007/4009、旧 responder、未知create预留、活动可见poll/计时器释放、真实FileReader+REST图片上传目标、模型确认归属、129控制请求高水位。
5. 页面 wire suite 证明 Markdown/工具/人机请求、A→B→A、占用会话过滤、失败不替换、延迟发送不清 B 草稿、隐藏草稿取消/确认离开；图片hook测试验证 100MiB共享预算、连续添加、关闭最近8个、tip迁移、owned URL恰好释放。
6. 隔离 Vite 页面使用实际 WebChatPage 和真实共享 channel，服务器由 web 测试 fixture 模拟。320px 的 document.scrollWidth=320，菜单可达且不越界，长标题截断、箭头切换保留焦点，A/B草稿独立。桌面关闭等待会话后出现后台入口，重开后原审批可处理，页面观察为1条连接。
7. 截图：narrow-menu.jpg（320×780，实际项目Tailwind源扫描）、desktop-background.jpg（1280×720，关闭审批会话后后台入口）。隔离预览初期CSS扫描不完整的截图未作为最终证据，修正后采集以上文件。
8. 真实远端的只读 HTTP探测返回302到登录；未获得已认证WS，未创建远端测试会话、发送prompt或改变服务器配置。

## 黑盒覆盖范围（不是部署验收通过声明）

| 案例 | 已有证据 | 尚未验收范围 |
|---|---|---|
| B01 | 5缓存页签100次选择零RPC/零dial，单活动正文 | 固定设备5×100消息的生产p95/CPU/heap |
| B02–B05 | 页面+workspace wire；延迟操作目标、占位及迟到选择保护 | 真实部署压缩lineage竞争/图片网络故障压力 |
| B06 | 页面草稿、窄屏键盘、视图保存实现、URL/hook测试 | 长列表真实滚动anchor与全部展开组合 |
| B07–B11 | 后台事件/请求、pre-attach、旧responder、closed提升，实际隔离页面 | 远端additive附着、第二真实客户端 |
| B12 | 页面secret不进storage/history、断线清值实现、129项请求保留 | 大量真实secret/批量问答交错压力 |
| B13–B18 | 真实channel重叠seq、truncated/cold竞争、2并发、4007/4009、epoch换代按stored恢复；visible follow定时器 | 部署epoch重启、全量长历史与终态结算延迟实测 |
| B19–B20 | lost prompt不重发/不清同文草稿、lost create保留容量，忙时不回收 | 真实弱网超时 |
| B21–B27 | 关闭不发close/delete/interrupt、closed请求、16容量、安全回收；离线排除实现 | 两真实客户端、真实网络在关闭邻居恢复时中断 |
| B28–B29 | histories<=8/64MiB保留、大行裁剪、有限preview、File100MiB/25MiB预算 | 全量RPC解码heap峰值 |
| B30–B31 | 单视图poll与disposal，320px菜单/长标题/键盘，桌面后台入口 | 200%缩放、真实子代理日志/media网络追踪 |
| B32–B33 | 缺失activate进入显式兼容，4009保留局部真实错误；手动兼容入口 | 目标部署实际非additive判定、5032/auth完整矩阵 |
| B34 | 页面隐藏草稿取消离开/确认profile切换；URL和timer释放 | 真实Tauri/native离开 |
| B35 | Rust透明桥保持源码不变、共享协议不变 | 浏览器真实登录WS与Tauri实际隧道关闭/恢复 |

## 未执行与交付限制

- 远程302/login是部署验收缺口，不能用fixture声称该服务器已经支持additive。缺失可选replay使用保守恢复；已证明非additive时由显式兼容路径处理。
- 原生Tauri未运行、固定设备生产p95/CPU/heap峰值未测。没有声称<100ms、精确heap上限或所有B01–B35通过。
- 原协议无detach/atomic cursor；已有全量回复的网络/JSON解码峰值不受本地LRU保证。
- 本次没有提交、推送、部署、归档。回滚只需撤回web变更，服务器历史/配置不变。

## 失效条件

涉及连接/会话/恢复/cache/controller/hook/页面/请求组件、相关测试fixture或共享协议依赖发生变化时重新验证对应证据。截图只证明所记录视口与隔离fixture页面，不能迁移为真实服务器/native性能证据。范围指纹与最终检查结果见 verification.yaml。
