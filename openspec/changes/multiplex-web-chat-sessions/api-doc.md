# 现有远程 API 使用约定（仅客户端适配）

2026-10-13 修订。本文是 Web 客户端如何使用服务器已有协议的设计，**不是新增服务端契约**。服务器代码、配置、共享类型与协议生成文件不修改。前一版提出的快照/解绑方法和新字段全部不再是实施前置。

## 1. 连接与可修改范围

沿用现有 `/api/ws`、登录 cookie/一次性 WS ticket/本地注入令牌、JSON-RPC 2.0 和 base path。只修改 web/src/lib/gatewayClient.ts，使 wrapper 接收工作区需要的已存在 `replay: false` 构造选项；apps/shared 的客户端实现保持只读。

一套心跳、票据和重连服务同工作区多个会话。Rust 桥沿用原有双向转发及关闭码/原因，不模拟服务端回复，不提供新的 snapshot/detach endpoint。新前端可以单独构建/发布，服务器无需配套代码部署。

## 2. 身份和既有返回

- workspace scope 是 origin + HERMES_BASE_PATH + selected profile。
- session.resume.session_id 使用持久化ID，正常发送/停止/模型/图片/子代理和 activate/events.since 使用运行ID。
- 解析 resume 返回的 stored_session_id、session_key、resumed、info.stored_session_id 等已有字段，并跟随服务器已解析的tip；无法确认身份时拒绝把结果归属到另一个活动会话。
- connectionGeneration/sessionGeneration/viewSelectionVersion 是前端本地状态，不发给服务器。
- 服务端事件从 event envelope的session_id归属；服务端请求从 params.session_id归属。无sid的全局事件不进聊天正文。

## 3. 允许的现有 RPC

| 方法 | 客户端使用 | 关键约束 |
|---|---|---|
| session.create | 同一WS创建新会话 | source=gui、close_on_disconnect=false；结果不确定不自动重复 |
| session.resume | 首次历史打开、运行实例失效、后端重启、冷恢复 | 传stored ID/profile；完整返回不等于原子seq快照 |
| session.activate | 真实重连时附着已知runtime；冷follow校准已有实例 | warm视图切换不调用；runtime不存在转resume |
| session.events.since | 完整live-valid缓存且epoch/runtime未变时补发 | last_seen是实际已应用seq，不是收到最高序号或快照游标 |
| session.history | 已有命令/历史核对路径按需使用 | 只有messages/count，不能补出可信快照cursor |
| session.list | 工作区共享历史选择列表 | 不可依据最近100项缺席认定会话被删除 |
| prompt.submit / session.interrupt | 明确目标的发送与显式停止 | 不自动重发提示；关页签不调用interrupt |
| config.set/model.options、slash/command、image、subagent | 当前既有功能 | 参数捕获发起会话，保持模型确认、图片清理和请求规则 |
| gateway.capabilities | 如现有功能需要，可读现有字段 | 没有复用版本字段不等于不支持已有多会话；不扩展其响应 |

普通页签关闭、LRU或连接容量管理不调用session.close/delete。禁止发送服务器尚未实现的方法或额外参数，尤其是attachment fencing、原子快照cursor和受限历史参数。

## 4. 典型既有请求

### 首次历史附着

```json
{
  "jsonrpc": "2.0",
  "id": "w17",
  "method": "session.resume",
  "params": {
    "session_id": "stored-A",
    "profile": "coding",
    "source": "gui",
    "close_on_disconnect": false
  }
}
```

使用result中的已有session_id建立运行映射，messages/info/running/inflight/open_requests恢复界面。共享channel会在promise resolve之前交付open_requests，路由必须允许附着待定状态。结果可能没有seq、epoch等附加信息，不猜测不存在的字段。

### 完整缓存的重连附着与补发

```json
{
  "jsonrpc": "2.0",
  "id": "w18",
  "method": "session.activate",
  "params": { "session_id": "runtime-A", "profile": "coding", "omit_messages": true }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": "w19",
  "method": "session.events.since",
  "params": { "session_id": "runtime-A", "profile": "coding", "last_seen": 812 }
}
```

result的已有events、latest_seq、truncated、epoch、open_requests用于恢复。只有同epoch、同runtime、完整投影时可将连续seq帧与同时抵达的live帧去重。events.since不会自动把runtime绑定到调用WS，也不能恢复缺失的历史基线。

### 运行中冷恢复的显示校准

```json
{
  "jsonrpc": "2.0",
  "id": "w20",
  "method": "session.activate",
  "params": { "session_id": "runtime-A", "profile": "coding", "omit_messages": false }
}
```

这就是已有完整返回，不是新增snapshot接口。可见活动会话处于snapshot-follow时最多每秒一次、无重叠；返回替换临时正文，不能把并发delta直接加在已含同一文本的inflight上。终态之后用完整final text和稳定history校准。没有事务cursor，不能宣布精确原子边界。

## 5. 关闭与成员关系限制

没有远程单会话取消绑定API，前端无法只断开A而保留同一WS的B绑定。关A仅移除本地视图和重缓存；这代连接的A轻量登记保留，迟到事件仍按A处理。新的运行/人机请求晋升可见后台跟踪。

直到该WS真正结束，服务器才按自己的既有断连规则处理成员关系。不能以调用session.close模拟解绑，因为它可能终止运行实例并影响其他窗口。

本连接曾关联的runtime和reserved create容量合计最多16；关闭本地页签不假装释放远端slot。安全全连接回收只在D8条件满足且用户明确触发时执行一次，重连仅恢复需要的页签。真实断线自然按恢复流程执行。

## 6. 错误与兼容处理

| 已有错误/情况 | 前端行为 |
|---|---|
| -32601 方法不支持 | 判断具体可选能力；无replay可用保守恢复，无additive附着则明示单活动兼容 |
| 4007 runtime不存在 | 保留stored ID，resume恢复，不无限activate旧ID |
| 4009 正在结算 | 局部可重试状态，不抢占、不宣布旧版 |
| 5032 Agent仍在构建 | 保留loading/局部状态，有限重试，无额外WS |
| 权限或profile拒绝 | 显示真实原因，不把其他profile作为fallback |
| WS断开或epoch改变 | 禁用旧responders，保留已知内容，以一套重连恢复 |
| replay截断/缺号 | 投影失效，完整返回替换，不拼补发后缀到空历史 |
| prompt/create ACK未知 | 不自动重试、不按相同历史文字猜测；保留不确定上下文 |
| 无原子快照边界 | 冷运行使用snapshot-follow，不假装exactly-once |

服务器版本/API的实际支持只能由远端真实行为确认，本地源码只能作为适配依据。无新capability字段是正常情况，不是强制兼容原因。一次成功RPC也不足以证明另一会话仍会继续收到事件。

## 7. 性能、记录与交付

现有完整响应不支持客户端请求的max_messages/max_history_bytes。前端只能在收到后裁剪保留量；JSON网络/解码峰值单独测量并报告。不能通过Rust返回裁剪的假响应来宣称服务器支持受限快照。

用web内wire fixture验证生成/恢复/竞争，真实远端验收并行会话、open_requests、epochs和实际additive行为。无Python服务端测试开发、无协议再生成、无服务器安装/配置修改。所有正式修改文件在web/，现有服务器发布独立不受影响。


## 8. 站内导航与刷新（2026-10-14）

站内Files/Logs往返保留现有连接与本地工作区，不新增RPC；完整聊天视图卸载时暂停视图轮询。缓存有效的返回不需要resume/activate/history。真正刷新后按scoped sessionStorage里的stored ID清单，在一个新WS上以最多2个并发调用既有session.resume恢复，局部拒绝仍显示原错误。此清单不包含runtime ID、正文、草稿、请求元数据或秘密，不能据ID存储宣称刷新后保持实时连接。
