## Context

阶段apply，风险standard：构建依赖与产物路径变化；共享源码byte-stable且协议不变。用户已授权独立前端构建。现有AGENTS修改保持并随本实现修订。只允许web/写入。

## Goals / Non-Goals

**Goals:** 冻结锁文件独立安装，类型检查后生成dist，完整checkout与独立副本走同一仓库内依赖，共享快照可追溯/可显式更新。

**Non-Goals:** 不改后端、共享原件或原生打包，不要求后端在线完成构建，不宣称静态文件自带Hermes服务，不改协议行为。

## Decisions

1. 将apps/shared的非测试源码、package.json与MIT LICENSE固定到vendor/hermes-shared。保留整个入口的传递依赖与生成契约，避免手工缩减导致协议/类型分叉。记录来源commit/tree和SHA-256；正常构建不下载/同步上游。
2. sync维护命令需显式source+ref，从指定Git对象复制，不读源checkout未提交改动；检测现有快照的本地修改再更新。generated文件仅复制，不重新生成。
3. package file依赖、TS路径、Vite与Vitest均指向vendor。取消父项目引用；使用tsc -b及Vite本地构建，默认dist。现有build:desktop明确输出dist-desktop，不动Rust。
4. 验收在系统临时目录的Web-only副本执行；没有父级apps/shared/scripts/node_modules，重新pnpm install --frozen-lockfile再执行类型、Vitest和build。不以父项目中的成功构建代替独立证据。

## Risks / Trade-offs

- 快照需要维护 → 来源/校验及显式同步命令，未来合并上游共享变化时同步后运行Web回归。
- 默认产物路径迁移 → README说明dist，不隐式覆盖父级web_dist；部署到现有服务器是另一步。
- 复制代码的许可证 → 保留上游MIT版权文字与完整许可证。
- 完整历史响应资源限制不受本次构建变更影响；不借依赖调整修改聊天逻辑。
