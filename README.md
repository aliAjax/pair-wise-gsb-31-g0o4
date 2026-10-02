# ReSwap 二手闲置物品交换平台

```bash
pnpm install
pnpm dev
```

访问地址：`http://localhost:18415`

## 项目介绍

ReSwap 是一个纯前端以物换物 Web 应用。用户可以本地模拟登录、发布闲置物品、浏览他人物品、发起交换请求，并在浏览器内管理交换记录。

## 主要功能

- 首页瀑布流浏览、分类筛选、关键词搜索；已交换物品保留在列表并附「交割依据」。
- 物品详情、物主资料、选择自己的物品发起交换。
- 发布物品，支持本地 base64 图片上传、分类和成色选择。
- 交换管理，区分我发起的和我收到的请求，支持同意、拒绝、完成。
- **不可改交割单**：交换完成瞬间冻结双方物品与资料快照；物品之后改名、下架，原交割单仍显示成交时内容。
- **写入失败恢复**：按「先落交割单 → 成对更新物品 → 标记交换完成」顺序提交；中断后从最近一张完整交割单向回恢复，两侧物品状态在同一次写入中补齐，重试不会重复生成交割单。
- **旧数据升级**：存储升级到 v2 时，已完成交换按完成时间从早到晚回填交割单，全程幂等。
- **三处同一依据**：首页卡片、物品详情、交换页都从同一个交割单 store 读取成交内容。
- 个人中心，编辑资料、上传头像、查看我发布的物品。
- 主题切换、全局错误处理和 Vant 提示。

## 启动与构建

```bash
pnpm install
pnpm dev
```

```bash
pnpm build
```

生产部署：执行 `pnpm build` 后，将 `dist/` 目录交给 Nginx 或任意静态文件服务器托管。

## 技术栈

| 类型 | 技术 |
| --- | --- |
| 框架 | Vue 3 + TypeScript |
| 构建 | Vite |
| 状态管理 | Pinia |
| 路由 | Vue Router 4 |
| UI | Vant + Tailwind CSS |
| 持久化 | localStorage + IndexedDB（idb-keyval） |
| 工具库 | dayjs、lodash-es |

## 项目目录结构

```text
src/
├── api/              # userApi.ts, itemApi.ts, exchangeApi.ts, settlementApi.ts：本地数据 API 层
├── stores/           # authStore.ts, itemStore.ts, exchangeStore.ts, settlementStore.ts, themeStore.ts
├── models/           # user.ts, item.ts, exchange.ts, settlement.ts：独立数据模型
├── types/            # 共享类型补充
├── components/common/# ItemCard, CategoryFilter, ItemImageGallery, UserBrief, ExchangeCard, SettlementNote, ImageUploader, EmptyState, AvatarUploader
├── hooks/            # useAuth.ts, useLocalStorage.ts, useExchangeStats.ts
├── pages/            # Home, ItemDetail, Publish, Exchanges, Profile
├── router/           # index.ts + guards.ts
├── utils/            # storage.ts, migrations.ts, settlementSnapshot.ts, formatters.ts, validators.ts, message.ts, themeUtils.ts
├── constants/        # item.ts, exchange.ts, settlement.ts, themes.ts, messages.ts
├── App.vue
├── main.ts
└── styles.css
scripts/              # 交割单/迁移/并发逻辑自检脚本（node + esbuild 转译）
```

## 数据持久化说明

- `utils/storage.ts` 统一封装 localStorage 和 IndexedDB（当前存储版本 **v2**）。
- 所有 `api/*Api.ts` 通过 `storage.ts` 读写数据，不在组件里直接写业务数据。
- 存储层包含序列化、版本号、过期清理、存储 key 管理；旧版本信封由 `utils/migrations.ts` 升级后才会被业务读取。
- 首次启动会写入演示用户、物品、交换请求和一张种子交割单（种子物品刻意演示「改名/下架后交割单不变」）。

### 不可改交割单（Settlement）

- 模型：`src/models/settlement.ts`，独立保存 `from_item / to_item / from_user / to_user` 成交瞬间快照，不引用活动 Item/User。
- API：`src/api/settlementApi.ts`
  - 交割单 id 由交换单确定性派生（`settlement_<exchangeId>`），天然幂等。
  - 提交顺序：① 交割单落盘（不可变）→ ② `itemApi.setPairStatus` 同一次写入把两件物品一起置为已交换 → ③ 交换单标记完成，完成时间锚定交割单。
  - `recoverAll()` 从最近完整交割单向回扫描，物品两侧一起补齐、交换单批量补齐；已有交割单绝不重建。
  - 在途同一交换的并发完成共享同一个 Promise，双击不会产生两条记录。
- 旧数据升级：`src/utils/migrations.ts` 在应用启动、各 store 水合之前执行；已完成交换按 `updated_at`（完成时间）升序回填，升级成功后记录 schema 版本，重跑幂等。
- 展示：`src/stores/settlementStore.ts` 是首页 `ItemCard`、物品详情 `SettlementNote`、交换页 `ExchangeCard` 的唯一成交依据来源。
- 逻辑自检脚本（纯 node，使用 esbuild 即时转译）：
  - `scripts/test-settlement.ts`：快照不可变、崩溃恢复、两侧原子、不重复生成。
  - `scripts/test-migration.ts`：v1 信封升级与按完成时间回填。
  - `scripts/test-concurrency.ts`：并发双击只生成一张交割单。

## 横切关注点

- 主题切换：`stores/themeStore.ts`、`constants/themes.ts`、`utils/themeUtils.ts`、`App.vue`、`components/common/CategoryFilter.vue`、`components/common/UserBrief.vue`、`components/common/ItemCard.vue`。
- 全局错误处理/提示：`utils/message.ts`、`components/common/GlobalErrorBoundary.tsx`、`stores/authStore.ts`、`stores/itemStore.ts`、`stores/exchangeStore.ts`、`components/common/ImageUploader.vue`。

## 枚举出现位置清单

### ItemStatus

定义位置：`src/constants/item.ts`

出现位置：

- `src/models/item.ts`
- `src/constants/messages.ts`
- `src/api/itemApi.ts`
- `src/api/exchangeApi.ts`
- `src/stores/itemStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/components/common/ItemCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Publish.vue`
- `src/pages/Profile.vue`
- `src/models/settlement.ts`、`src/api/settlementApi.ts`、`src/utils/settlementSnapshot.ts`（成交快照冻结的物品状态使用同一枚举）。

### ExchangeStatus

定义位置：`src/constants/exchange.ts`

出现位置：

- `src/models/exchange.ts`
- `src/constants/messages.ts`
- `src/api/exchangeApi.ts`
- `src/stores/exchangeStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/hooks/useExchangeStats.ts`
- `src/components/common/ExchangeCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Exchanges.vue`
- 完成流程另由 `src/api/settlementApi.ts`、`src/stores/settlementStore.ts`、`src/models/settlement.ts`、`src/utils/migrations.ts` 承接（已完成态以不可改交割单为准）。

## 分层与高耦合约束

本项目保留提示词要求的“严禁合并职责到单一文件”：模型、常量、API、store、页面、组件、hooks、utils 均独立拆分。

同时保留“屎山代码设计要求”的低内聚高耦合特征：

- `utils/formatters.ts` 同时负责日期、物品状态、交换状态、成色、信用等级文本。
- `constants/messages.ts` 同时包含页面提示、表单校验、日志式文案和状态文案。
- `ItemStatus` 与 `ExchangeStatus` 被模型、API、store、组件、页面、router guards、formatters 多处引用。
- `utils/storage.ts` 是存储入口，但全应用 API 和 store 都依赖它的 key 与数据结构。

例如新增 `ItemStatus.BOOKED` 时，应至少修改：`src/constants/item.ts`、`src/models/item.ts`、`src/api/itemApi.ts`、`src/api/exchangeApi.ts`、`src/stores/itemStore.ts`、`src/router/guards.ts`、`src/utils/formatters.ts`、`src/constants/messages.ts`、`src/components/common/ItemCard.vue`、`src/pages/ItemDetail.vue`、`src/pages/Publish.vue` 等文件。

## 环境变量

当前项目无必需环境变量。

## License

MIT
