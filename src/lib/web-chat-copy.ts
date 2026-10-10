const en = {
  title: "Web Chat", subtitle: "A direct conversation with Hermes. No terminal required.",
  emptyTitle: "What would you like to work on?", emptyHint: "Ask a question, explore your project, or let Hermes handle a task.",
  placeholder: "Message Hermes…", send: "Send", stop: "Stop", stopping: "Stopping…",
  newChat: "New chat", reconnect: "Reconnect", connected: "Connected", disconnected: "Disconnected",
  connecting: "Connecting…", loading: "Opening conversation…", thinking: "Hermes is working…",
  waiting: "Waiting for your response", you: "You", reasoning: "Reasoning", tool: "Tool",
  interrupted: "Stopped", failed: "Failed", working: "Working", complete: "Complete",
  keyboard: "Enter to send · Shift+Enter for a new line", saved: "History is saved on the server. Refresh to resume.",
  once: "Allow once", session: "Allow for this session", always: "Always allow", deny: "Deny",
  approval: "Approval required", clarify: "Hermes has a question", secret: "Private input required",
  answer: "Your answer", respond: "Continue", skip: "Skip", password: "Password or secret",
  scroll: "Jump to latest", copy: "Copy message", copied: "Copied", copyFailed: "Could not copy message",
  sessionId: "Session", retryHint: "Reconnect to check server state. Messages are never automatically resent.",
  switchSession: "Switch conversation", loadingSessions: "Loading conversations…", sessionsFailed: "Could not load conversations", switchBlocked: "Stop the current turn before switching conversations.",
  sessionMessages: "{count} msgs",
  toolCalls: "Tool calls", toolArguments: "Arguments", toolOutput: "Output", toolResultUnavailable: "This history snapshot does not include the tool output.",
  samples: ["Explain the structure of my project", "Help me plan the next step", "What can you help me with?"],
};

export type WebChatCopy = typeof en;

const zh: WebChatCopy = {
  title: "网页对话", subtitle: "直接与 Hermes 对话，无需终端界面。",
  emptyTitle: "今天想一起做些什么？", emptyHint: "提出问题、探索项目，或者把一项任务交给 Hermes。",
  placeholder: "给 Hermes 发消息…", send: "发送", stop: "停止", stopping: "正在停止…",
  newChat: "新对话", reconnect: "重新连接", connected: "已连接", disconnected: "连接已断开",
  connecting: "正在连接…", loading: "正在打开对话…", thinking: "Hermes 正在处理…",
  waiting: "等待你的回复", you: "你", reasoning: "思考过程", tool: "工具",
  interrupted: "已停止", failed: "失败", working: "执行中", complete: "已完成",
  keyboard: "（Enter 发送 · Shift+Enter 换行）", saved: "历史保存在服务端，刷新后可恢复。",
  once: "仅允许本次", session: "本会话允许", always: "始终允许", deny: "拒绝",
  approval: "需要你的批准", clarify: "Hermes 有一个问题", secret: "需要私密输入",
  answer: "你的回答", respond: "继续", skip: "跳过", password: "密码或密钥",
  scroll: "回到最新消息", copy: "复制消息", copied: "已复制", copyFailed: "无法复制消息",
  sessionId: "会话", retryHint: "请重新连接确认服务端状态。消息不会自动重发。",
  switchSession: "切换会话", loadingSessions: "正在加载会话…", sessionsFailed: "会话列表加载失败", switchBlocked: "请先停止当前执行，再切换会话。",
  sessionMessages: "{count} 条消息",
  toolCalls: "工具调用", toolArguments: "调用参数", toolOutput: "执行结果", toolResultUnavailable: "历史会话快照未提供工具输出。",
  samples: ["解释一下当前项目的结构", "帮我规划接下来的工作", "你可以帮我做些什么？"],
};

export function webChatCopy(locale: string): WebChatCopy {
  return locale.startsWith("zh") ? zh : en;
}
