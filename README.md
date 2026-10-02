# ReSwap 二手闲置物品交换平台

```bash
pnpm install
pnpm dev
```

访问地址：`http://localhost:18415`

## 项目介绍

ReSwap 是一个纯前端以物换物 Web 应用。用户可以本地模拟登录、发布闲置物品、浏览他人物品、发起交换请求，并在浏览器内管理交换记录。

## 主要功能

- 首页瀑布流浏览、分类筛选、关键词搜索，并展示最近成交的不可改交割单。
- 物品详情、物主资料、选择自己的物品发起交换；已成交物品显示成交依据交割单。
- 发布物品，支持本地 base64 图片上传、分类和成色选择。
- 交换管理，区分我发起的和我收到的请求，支持同意、拒绝、完成。
- **不可改交割单**：每笔完成的交换都会冻结双方物品与资料快照，物品事后改名、下架，原交割单仍显示成交时内容。
- **崩溃恢复与旧数据回填**：交割采用两阶段提交，写入失败后从最近完整交割单恢复，双方物品状态整表一次写回（不会只改一侧），重试幂等不重复生成记录；旧版本数据启动时按完成时间回填交割单。
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
├── components/common/# 共享业务组件、ReceiptCard 和 GlobalErrorBoundary
├── hooks/            # useAuth.ts, useLocalStorage.ts, useExchangeStats.ts
├── pages/            # Home, ItemDetail, Exchanges, Profile, Publish
├── router/           # index.ts + guards.ts
├── utils/            # storage.ts, settlementCore.ts, formatters.ts, validators.ts, message.ts, themeUtils.ts
├── constants/        # item.ts, exchange.ts, settlement.ts, themes.ts, messages.ts
├── App.vue
├── main.ts
└── styles.css
```

## 数据持久化说明

- `utils/storage.ts` 统一封装 localStorage 和 IndexedDB，信封带版本号（当前 v2）与过期时间，旧版本数据仍可读，下次写入自动升级。
- 所有 `api/*Api.ts` 通过 `storage.ts` 读写数据，不在组件里直接写业务数据。
- 存储层包含序列化、版本号、过期清理、存储 key 管理。
- 首次启动会写入演示用户、物品和交换请求。

### 不可改交割单（成交依据）

- 模型：`src/models/settlement.ts`（`SettlementReceipt` 及物品/用户快照、待提交标记）。
- 核心逻辑：`src/utils/settlementCore.ts`（纯函数，可注入故障网关）；API：`src/api/settlementApi.ts`；状态：`src/stores/settlementStore.ts`；展示：`src/components/common/ReceiptCard.vue`。
- 完成交换时冻结双方物品标题、描述、成色、图片与双方昵称、信用分等快照；交割单只追加、不修改、不删除。物品之后改名或下架，首页、详情页、交换页仍显示成交时内容，且三处共用同一份交割单。
- 两阶段提交：先写 pending 标记 → 物品整表一次写回（两侧同时置为已交换，不会只改一侧）→ 交换置为已完成 → 追加交割单（id 固定派生自 exchange id）→ 清 pending。
- 任一步失败后重试或重启都从最近完整交割单恢复：缺失的一侧物品状态被补齐，交割单绝不重复生成，完成时间不漂移。
- 旧数据升级：启动时对所有已完成交换按完成时间（`updated_at` 近似）回填交割单并重排流水号，已有交割单保持不变。
- 测试：`pnpm test`（vitest），覆盖幂等提交、各类崩溃点恢复、两侧原子更新、旧数据回填与真实存储链路集成。

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
- `src/utils/settlementCore.ts`
- `src/stores/itemStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/components/common/ItemCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Publish.vue`
- `src/pages/Profile.vue`

### ExchangeStatus

定义位置：`src/constants/exchange.ts`

出现位置：

- `src/models/exchange.ts`
- `src/constants/messages.ts`
- `src/api/exchangeApi.ts`
- `src/api/settlementApi.ts`
- `src/utils/settlementCore.ts`
- `src/stores/exchangeStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/hooks/useExchangeStats.ts`
- `src/components/common/ExchangeCard.vue`
- `src/components/common/ReceiptCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Exchanges.vue`

### 交割单常量（SETTLEMENT_SCHEMA_VERSION / RECEIPT_ID_PREFIX）

定义位置：`src/constants/settlement.ts`

出现位置：

- `src/models/settlement.ts`
- `src/api/settlementApi.ts`
- `src/utils/settlementCore.ts`
- `src/stores/settlementStore.ts`
- `src/components/common/ReceiptCard.vue`

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
