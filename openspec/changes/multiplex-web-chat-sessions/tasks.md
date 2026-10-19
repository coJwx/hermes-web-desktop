客户端实现与自动化验证已完成，远程部署/原生及固定设备性能验收仍待执行，初次证据见 evidence/client-verification.md；2026-10-14修复的最新证据见 evidence/performance-verification.md。**实施写入范围只允许web/**。tui_gateway/hermes_cli/apps/shared/apps/desktop及服务器配置为只读依据，不新增服务器接口、不生成协议。Rust仅在现有生命周期集成确有缺口时修改web/src-tauri。

## 1. 范围与远程既有协议核验

- [x] 1.1 在web内建立使用真实共享GatewayClient/JSON-RPC channel的wire fixture，模拟已有多会话事件/请求和可暂停ACK，不实现产品所需新RPC（B03/B09/B13/B14）。
- [ ] 1.2 对目标现有服务器验证同WS两个会话additive附着、现有字段和恢复行为；只有正常测试会话操作，不能部署/改服务器配置。不可用环境标为待验证（B07/B32/B35）。
- [x] 1.3 固定允许文件清单、只读共享包依赖和Rust桥边界；记录基线连接/RPC/cache观察点与兼容判据，不把未知版本当作新capability。

## 2. 会话数据与操作拆分

- [x] 2.1 将单WebChatController的message/tool/subagent投影提取为独立会话reducer和状态，保持现有工具/Markdown/图片展示行为。
- [x] 2.2 实现stored/runtime/profile/connection/session/view代际映射和lineage去重；请求/操作始终捕获目标，不因选择别的页签失效（B05/B09/B34）。
- [x] 2.3 会话级草稿、图片、cursor/anchor/follow/展开状态及不确定提交上下文；秘密表单内容不缓存、不按任意历史同文删除草稿（B06/B12/B19）。

## 3. 单连接工作区

- [x] 3.1 在web wrapper通过现有构造选项关闭自动replay；工作区拥有唯一WS、认证/心跳/退避调度和历史列表刷新，apps/shared源码不变（B01/B13）。
- [x] 3.2 实现runtime路由、全局事件、有限pending attach缓冲及closed retainedBindings；普通背景正文不通知另一活动视图（B07/B11）。
- [x] 3.3 请求按epoch/runtime/id认领、去重、替换responder和取消对账，保持背景等待入口及旧闭包失效（B08–B12）。
- [x] 3.4 把摘要和正文订阅分离，按设计发布频率合并UI通知，终态/请求立即更新；后台不挂完整聊天页面。

## 4. 现有协议恢复

- [x] 4.1 实现唯一恢复owner、<=2附着并发和分会话局部错误；原runtime附着，4007或epoch变化按stored resume（B13/B17/B18）。
- [x] 4.2 live-valid缓存用actualAppliedSeq补发、live缓冲和seq去重；缺口/truncated/epoch无效转refresh-required，禁止虚构snapshot cursor（B13/B14/B17）。
- [x] 4.3 运行中冷恢复用既有完整返回replacement和活动可见1秒无重叠snapshot-follow；终态全文/有限稳定history校准，隐藏后停止poll（B14–B16）。
- [x] 4.4 明确prompt/create ACK未知、不自动重试；未知create成员预留容量，忙时保持其他会话，安全时可通过结束旧连接解除不确定关联（B19/B20）。

## 5. 关闭与关联容量

- [x] 5.1 普通关闭释放本地视图、完整历史和可释放媒体，保留有限轻量当前代登记；禁止调用close/delete/interrupt代替解绑（B21/B23/B27）。
- [x] 5.2 运行/请求对象移除页签后仍有trackedTasks入口，closed runtime收到新请求自动晋升；终态转登记而非伪解绑（B11/B22）。
- [x] 5.3 16关联容量计入关闭记录、pending create和未知create；满时只允许复用/处理已有会话，不把本地关闭当作释放服务器slot（B20/B24）。
- [x] 5.4 明确用户触发的idle整连接回收和忙时拒绝条件；保留必要缓存/草稿，只恢复需显示对象，真实网络断线走正常恢复（B25/B26）。

## 6. 前端资源预算

- [x] 6.1 实现8 histories/64MiB双预算、显示尾窗、有限运行预览和projection状态；被LRU淘汰历史不能由后台delta无限重建（B28）。
- [x] 6.2 实现文本/图片及closed最近草稿预算；空项删除、新图片超限拒绝、owned URL生命周期和活动草稿保护（B06/B29/B34）。
- [x] 6.3 缓冲超限局部保守恢复，控制请求高水位优先保留并暂停新工作；明确全量RPC解码峰值需真实浏览器实测，不发送新limit参数（B12/B14/B29）。

## 7. 单视图、交互和Rust范围

- [x] 7.1 接入薄useWebChat/useWebChatTabs和一个活动视图；加号transactional open、占位复用、迟到结果不抢焦点、warm切换无恢复RPC（B01–B06）。
- [x] 7.2 页签摘要/后台任务入口、键盘/窄屏/浮层位置与scroll恢复；可见会话才poll roster/tail，冷follow遵循可见限制（B08/B22/B30/B31）。
- [x] 7.3 聚合dirty/busy接入已有leave/profile/native guard；Rust默认不改，只有证据表明现有生命周期接入需修复时才限src-tauri改动，禁止扩展代理协议（B34/B35）。

## 8. 客户端验收与交付

- [x] 8.1 在web Vitest覆盖两份spec的关键不变量，复用真实共享库导入；不写Python服务端开发任务、不读源码文本作为行为测试。
- [x] 8.2 执行Web tsc/build、相关现有图片/命令/模型/子代理suite；Rust有改动才执行既有desktop/cargo检查。确认修改文件均在web/，无生成契约变化。
- [ ] 8.3 按blackbox-test.md完成B01–B35及固定设备性能/资源测量，目标远程部署和Tauri桥未跑项如实记录；fixture通过不冒充服务器行为验证。
- [x] 8.4 同步README.web-chat.md的warm/cold恢复、closed绑定限制、关联上限和草稿语义；记录实际证据/范围指纹/失效条件，回滚只涉及Web/Tauri客户端。

## 9. 2026-10-14 流式计量与关闭会话优化

- [x] 9.1 修复web wrapper的replay选项转发，并以真实共享channel验证显式关闭与默认行为。
- [x] 9.2 使用增量缓冲/请求字节计数，验证跨队列总预算、替换、转移、取消和清空。
- [x] 9.3 缓存不可变历史大小、复用摘要引用、定位当前消息，关闭视图失效正文投影且保留请求/终态/序号。
- [x] 9.4 通过行为回归、tsc/build、序列化调用量复测，并记录范围指纹与未验证限制。

复选框表示对应客户端实现与已记录的本地证据。1.2 和 8.3 保持未完成：远程登录阻挡实际部署验收，Tauri/native 与固定设备 p95/heap 峰值未执行。黑盒范围按证据分层记录，fixture 不等于部署支持。


## 10. 2026-10-14 跨路由工作区与刷新恢复

- [x] 10.1 将profile工作区所有权提升到Routes父级，首次访问懒初始化；站内导航保留唯一WS/缓存，视图隐藏停止相关轮询（B36/B37）。
- [x] 10.2 常驻持有有限文字/图片/object URL与视图状态；路由往返恢复scroll/cursor/展开/标题tabs，异步结果保持原目标（B36/B37）。
- [x] 10.3 保留profile/刷新/native聚合保护，允许保留型聊天草稿的站内导航；识别profile query补回并保留其他编辑器保护（B38）。
- [x] 10.4 只持久化scoped stored IDs/顺序/活动项；兼容旧ID键，<=2恢复并发，处理提前请求、坏清单、重复/失效身份（B39）。
- [x] 10.5 执行关联DOM/wire回归、编辑器/原生leave相关回归、tsc/build及OpenSpec严格检查；记录证据和真实部署/native未验收范围。

本轮客户端行为证据见evidence/route-retention-verification.md及同名YAML。真实部署/native/固定设备性能未验收，1.2和8.3保持未完成。

## 11. 2026-10-15 缓存与请求审查修复

- [x] 11.1 模型缓存按runtime/连接代际失效，warm replay后校准，warm页签选择不重复读取；覆盖旧响应及已确认选择保护。
- [x] 11.2 Files单入口加载和latest-response校验；Logs取消旧筛选、无重叠/隐藏轮询及阅读位置保护。
- [x] 11.3 工作区历史媒体LRU、同源profile/path隔离、并发读租用和取消、容量淘汰及profile退出清理；保持嵌入图片直显。
- [x] 11.4 模型菜单rAF/位置去重/忽略内部滚动，兼容Window目标并清理待执行帧；保留点击才选择提供商。
- [x] 11.5 执行相关行为回归、typecheck和build，记录本地证据及真实远端/native/CPU/heap未验证边界。

本轮证据见evidence/cache-request-fixes-verification.yaml；1.2和8.3的远端/native/固定设备验收仍未执行。
