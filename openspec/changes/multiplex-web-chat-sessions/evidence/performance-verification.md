# 流式计量修复验收（2026-10-14）

用户授权修复上一轮审查中发现的客户端开销及replay选项不一致。修改范围限web/。没有改变apps/shared、服务器、生成协议或Rust，没有新增依赖、提交、推送或部署。

## 修复内容

- GatewayClient实际转发已有replay构造选项。Web workspace关闭共享自动replay，其他调用者保留默认行为。当前类型检查已恢复通过。
- retainedBytes直接估算UTF-16内容和固定对象/引用开销，用WeakMap缓存不可变payload/消息行/历史数组。消息替换和追加按行差值更新，不生成JSON计量正文。
- frames/held各自维护bytes，排出/清空/溢出归零；全工作区只合计数字以约束8MiB预算。普通delta不再提前计算另一个队列的完整文本大小。
- 请求元数据大小按不可变请求数组缓存，pending请求替换/转移/清空维护独立计数。普通流式输出不扫描请求payload。
- 显示窗口只校准变化会话，总预算使用缓存大小；未变化历史不重新读取。当前message定位复用索引，替换只浅复制引用数组。
- 页签摘要比较标量字段并复用对象/数组；正文delta无需构造摘要。终态、错误、请求和投影失效继续及时更新。
- 关闭会话释放正文/preview并标为refresh-required。忽略其后续正文拼接但保留seq、请求、忙/终态与错误；重新打开使用既有完整恢复。仍打开的后台页签继续保留warm正文缓存。

## 回归依据

新增测试在修复前失败：关闭replay仍发出events.since；普通发布重复读取未变化历史（804次属性读取）；关闭运行页签仍保留两行正文。对应行为在修复后通过。

最终检查：

- pnpm exec tsc -b --pretty false：通过。
- pnpm exec vitest run src/lib/web-chat src/pages/WebChatPage.test.tsx src/hooks/useWebChatImages.test.tsx src/lib/gatewayClient.test.ts：14文件、48项通过。
- pnpm exec vite build --outDir node_modules/.tmp/web-chat-multiplex-build：通过；产物只在web内临时目录。
- git diff --check：通过。
- OpenSpec严格校验结果见performance-verification.yaml。

专项行为包括：真实共享channel的replay开关与默认值、100条delta不序列化应用缓存/不读其他历史或请求payload/不通知摘要、跨队列总预算与drain/clear、消息大小在append/replace/trim后与独立重算一致、待绑定请求替换/转移/取消与字节释放、关闭后的审批/序号/完整终态，以及现有warm切换、流式工具/模型/图片、重连和离开保护回归。

## 相同数据规模的本地调用量对比

用Vite SSR加载实际WebChatWorkspace/缓存模块；5会话，每个初始100行，每行1024字符。等待初始化计时器结束，在一个有效live投影输入delta，分别计数即时处理、一次延迟订阅发布，以及另一个会话暂存128帧期间的当前delta。仅以本地fixture建立会话，没有访问远程服务器。JSON.stringify只做临时spy，执行后还原。

| 观察阶段 | 修复前应用内部stringify次数 | 修复后 |
|---|---:|---:|
| 正常delta即时处理 | 8 | 0 |
| 一次延迟发布 | 13（其中历史10次） | 0 |
| 另一会话暂存128帧时的当前delta | 8 | 0 |

修复前一次延迟发布生成1,064,714字符历史JSON；另一个恢复队列曾被扫描141,077字符。修复后这三阶段均无应用内部JSON序列化，摘要通知0次，仍保留5份历史。诊断计数：historyBytes=1,076,838，bufferedBytes=289,536（约束以内）。这些数字是计量/调用量证据，不是浏览器CPU、p95、RSS或heap实测。

网络JSON-RPC必要编码/解析继续使用共享channel；页面工具结果格式化等低频JSON显示用途不在“内部计量0次”的声明中。

## 限制与证据失效

- 数值是估算的保留内容/引用开销，不能声称精确heap或全量RPC解码峰值上限。估算依赖payload和投影的不可变约定；修改应产生新对象/数组。
- 本轮未执行真实部署、Tauri、固定设备浏览器p95/CPU/heap验收，1.2和8.3仍待验证。
- 原子快照cursor和单会话detach仍不存在；本轮未新增这类协议能力。
- 范围指纹见performance-verification.yaml；源文件、测试、计量策略或shared协议行为改变时需重新验收。本回执替代此前回执对这些修改文件的当前状态声明，历史截图仅保留其原视口/fixture证据范围。
