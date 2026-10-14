## Why

Web已发布为独立仓库，但依赖父级apps/shared及scripts/build/web.mjs；仅克隆该仓库无法安装并生成前端产物。用户已授权消除这些构建依赖，验收范围为前端产物，不要求桌面打包或后端独立运行。

## What Changes

- 将固定版本的共享包纳入web/vendor，保留源码字节、MIT许可证、来源提交/目录树与文件校验，并提供显式更新方式。
- package、TypeScript、Vite与测试使用仓库内共享包，pnpm锁文件同步，不引入新的外部运行依赖。
- **BREAKING**：pnpm build不再调用父项目构建器，默认前端产物从父级hermes_cli/web_dist改为当前仓库dist；类型检查继续执行。
- 新增独立仓库构建说明，同步AGENTS及现有README，保留现有build:desktop的显式dist-desktop输出。
- 在不含父级文件/node_modules的干净副本中以冻结锁文件安装、类型检查、测试及生产构建验证。

## Capabilities

### New Capabilities
- `standalone-web-build`：单独克隆Web后，仅用Node/pnpm生成dist前端产物，具有可追溯的共享依赖。

### Modified Capabilities

无。聊天协议与桌面运行时不变。

## Impact

仅修改web/，包括vendor快照、构建配置、锁文件、维护脚本与文档。不修改apps/shared原件、生成服务器协议、远程后端或Rust源文件。源码快照复制已经获得本次用户实施授权；不依赖未来服务器升级。构建后的业务仍需要Hermes服务与现有认证。
