# 2026-10-14 独立前端构建验证

阶段apply，风险standard。用户授权只在web/消除父目录构建依赖，验收前端dist，不做远端部署或原生打包。沿用此前未提交的AGENTS改动，并按新构建事实修订。

## 实现

- @hermes/shared固定为vendor/hermes-shared；package、TS、Vite、Vitest都使用该路径。
- 上游来源commit为66cd37c997fcc63423dfefbd5202e121641f49ca，apps/shared tree为601ddccdb7006cb322df87e163e27b142e4f073a。30个快照文件保留Git对象字节、MIT许可证和SHA-256；生成契约仅复制不再生成。父级apps/shared没有改动。
- pnpm build先tsc -b，再Vite生成本仓库dist；不读父级构建器，不连接后端。原build:desktop仍显式输出dist-desktop；Rust未改。
- 显式source+ref维护工具使用Git对象并保护已修改快照；2项真实临时Git仓库测试覆盖固定版本/未提交来源、许可证/哈希、本地修改拒绝、新文件及已移除文件对账。
- Web根.gitattributes保留快照精确字节；README/AGENTS说明构建、来源更新与静态产物的运行边界。保留既有README排版指导。

实现/快照/测试范围fingerprint：`c44e64446e23ecc109e4a6ee2626744100f271c8318ced64685f92598a9c4d5f`，按YAML列出的路径排序，拼接path+NUL+原始bytes+NUL后SHA-256。

## 已执行证据

1. Web-only源码副本位于`D:\Temp\hermes-web-verification\source-vl95vqmd`，初始无node_modules；父级没有apps/shared、scripts/build/web.mjs，也不存在祖先node_modules可供兜底。安装使用本机pnpm包缓存，不链接父项目node_modules。
2. 在该副本执行`pnpm install --frozen-lockfile --offline`、`pnpm typecheck`、`pnpm test`、`pnpm build`全部通过。Vitest 85文件/508项通过；Node v24.14.0、pnpm v12.6.0。已有JSDOM window.open/canvas提示不产生失败。
3. 在临时验证仓库提交完整Web快照，以core.autocrlf=true进行真正的`git clone --no-local`到`D:\Temp\hermes-web-verification\clone-verification`。30项provenance哈希全部保持；克隆目录无node_modules及父级/祖先构建依赖。再次冻结锁文件离线安装及pnpm build通过。
4. 当前完整checkout也执行pnpm build通过。当前dist与最终独立clone的dist逐文件SHA-256完全一致：63个文件、3,764,070 bytes；22个HTML/CSS本地引用都存在，包括字体和favicon。
5. `openspec validate standalone-web-build --strict`和`git diff --check`通过；变更仅在web/。

## 验收界限

- 安装使用已存在的pnpm缓存；首次无缓存机器仍需要registry网络。本次不修改registry或代理设置。
- 测试/构建和共享类型兼容不等于目标后端、OAuth、真实浏览器路由、安装器/原生打包验收。
- 静态前端产物不包含Hermes后端；运行业务仍需服务端API、认证与bootstrap注入。
- 未提交/推送/部署本次改动；公开远端仍是此前版本。上面的Git clone来自本地验证快照，不冒充从更新后的GitHub克隆。

上述fingerprint、共享来源、构建配置/依赖或引用的行为代码改变时需重验对应证据。
