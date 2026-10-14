# 2026-10-14 origin/main 合并验证

## 合并目标

- 当前分支：desktop-dev，合并前HEAD为86c502ca27。
- 上游：origin/main，合并目标66cd37c997。
- 使用普通merge commit保留本地3个提交及上游历史；工作区在开始时干净。

## 冲突处理

10个冲突文件已逐处整合：hermes_cli/web_routers/files.py、web/package.json、web/public/favicon.ico、web/src/App.tsx、ModelPickerDialog.tsx、ChannelsPage.tsx、ChatPage.tsx、FilesPage.tsx、ModelsPage.tsx、web/vite.config.ts。

- 保留当前Tauri脚本、图标、主题字体、文件预览、统一弹窗和中文交互，以及单WS多会话、性能优化和跨路由工作区。
- 采用上游Web构建入口与配置加载修复，更新Vitest到4.1.11并同步web/pnpm-lock.yaml。
- 合并上游动态辅助任务、插件任务继承和当前模型slot选择；保持本地弹窗及翻译布局。
- 文件预览保留，同时禁用失效符号链接；Python保留本地profile媒体隔离/线程读，同时接入上游SSH文件系统及错误映射。
- 上游澄清类型改为questions批量格式；Web内增加旧单问题字段的局部兼容类型，未修改共享协议或要求远端升级。
- 215个分支独有路径与合并前HEAD进行Git blob对照：除锁文件与上述RequestCard类型兼容外，其余213个内容一致。多会话工作区、草稿、恢复及Tauri源文件均保留。

## 已执行验证

- `pnpm exec tsc -b --pretty false`：通过。
- `pnpm exec vitest run`：84个文件、506项测试通过。
- `scripts/run_tests.sh tests/hermes_cli/test_web_server_media_async.py tests/hermes_cli/test_web_server_files.py tests/hermes_cli/test_ssh_workspace_fs.py -j 2`：使用现有.venv且经canonical runner清理环境，3个文件、23项通过、4项跳过。
- `pnpm run build --source D:/OpenSourceAI/hermes-agent --icons D:/OpenSourceAI/hermes-agent --out D:/OpenSourceAI/hermes-agent/.build/web-main-merge-66cd37c997`：采用上游构建脚本，类型检查及Vite生产构建通过。输出位于受支持的.build产物目录。
- `openspec validate multiplex-web-chat-sessions --strict`：通过。
- 冲突相关文件`git diff --cached --check`与unmerged index检查：通过。

旧route-retention/performance回执属于各自切片的历史证据；App/ProfileProvider/共享客户端/依赖在本次合并后已经变化，因此不能直接复用旧指纹作为当前验证。本记录的完整Web回归包含原聊天/路由/性能测试。

未执行全仓Python套件、原生安装/打包、远程部署和浏览器CPU/p95/heap验收。现有tasks 1.2与8.3仍未完成；未推送、部署或归档。
