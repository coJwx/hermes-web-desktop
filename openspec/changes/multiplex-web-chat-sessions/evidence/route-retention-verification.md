# 2026-10-14 跨路由保留与刷新恢复验证

阶段apply，沿用多会话变更的strict生命周期验收深度。用户已授权采用路由父级工作区、按需挂载聊天视图、仅ID刷新恢复；实现只改web/，未修改后端/共享包/Rust。

## 当前实现与范围

- App在ProfileKeyedRoutes内、Routes外持有WebChatWorkspaceProvider；只有首次访问内置Web Chat才初始化连接。插件加载与override保留原边界。
- provider持有单WS、原有有限历史缓存和WebChatDrafts；站内导航卸载完整聊天视图，不stop工作区。snapshot-follow增加路由可见条件；roster/tail随视图卸载。
- 文字、图片File/object URL、scroll/follow/cursor跨路由保留；推理/工具展开和子代理选择复用controller视图状态。图片URL在profile替换/工作区销毁时释放。
- 常驻guard保留profile/刷新/native的dirty/busy保护；保留型聊天草稿允许站内导航，其他编辑器仍按自己的dirty/busy保护。裸链接补回原profile query不算切scope。
- scoped version 1清单只保存stored IDs、顺序、活动ID；兼容原最近ID键。刷新恢复优先活动项且并发最多2；坏格式/存储拒绝安全回退；失效会话保留局部错误与重试，不create替代。
- 初次恢复也认领RPC结果前到达的人机请求，lineage重复合并；清单仅在结构/选择改变时写入。

代码范围SHA-256：`cbaceffd30b2cd2d4fe09f268c20634f5991ec90a4a29b314847ff08ce7a811d`。按YAML清单排序，每项拼接path、NUL、文件原始字节、NUL计算。旧performance-verification是前一切片历史证据；本次运行包含原性能回归，但未重新声称浏览器CPU/p95/heap测量。

## 已执行检查

```powershell
pnpm exec vitest run src/lib/web-chat src/pages/WebChatPage.test.tsx src/hooks/useWebChatImages.test.tsx src/lib/gatewayClient.test.ts src/pages/ConfigPage.test.tsx src/pages/SessionsPage.test.tsx src/pages/ChatPage.test.tsx src/pages/FilesPage.test.tsx
pnpm exec tsc -b --pretty false
pnpm exec vite build --outDir node_modules/.tmp/web-chat-multiplex-build
openspec validate multiplex-web-chat-sessions --strict
git diff --check
```

- 18个测试文件、70项测试通过；tsc通过，生产构建通过，OpenSpec严格检查通过，diff无空白错误。
- WebChatPage新增2项行为测试：四页签跨路由往返，草稿/图片/scroll/cursor/推理展开恢复，无额外会话附着RPC或WS；离开期间消息/审批仍可处理，隐藏时刷新保护持续，profile取消保留、确认关闭原WS并且URL只撤销一次。
- 刷新场景证明：首次访问前无WS；只持久化IDs；重复清单去重；活动项/顺序恢复；最多2个附着并发；提前请求可回复；删除身份不create且可重试；草稿不从存储复活；坏JSON/版本/ID和禁用storage安全回退。
- 扩展原冷运行轮询测试：路由隐藏且document仍visible时不activate，WS保持open、请求保持可达；返回恢复原1秒轮询，document隐藏再次暂停；stop后timer为0。
- ConfigPage/SessionsPage/FilesPage/ChatPage以及现有desktop-leave相关回归共同验证已有编辑器与退出行为没有被聊天保留策略统一绕过。

## 未验证范围

上述为真实共享GatewayClient/JSON-RPC通道加可控wire fixture及React DOM/router测试；不等于现有远程服务器部署验收。未执行实际Files/Logs浏览器往返、Tauri原生进程退出、目标服务器并行附着、固定设备p95/CPU/heap峰值。tasks 1.2与8.3继续未完成。无部署、提交、推送或归档。

失效条件：清单中的实现/测试、共享客户端行为、路由/profile所有权或存储格式改变时，重验相关行为。类型/构建相关配置或依赖变化也需重验。
