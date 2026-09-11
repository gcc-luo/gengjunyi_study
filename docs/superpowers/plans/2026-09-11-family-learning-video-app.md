# 家庭儿童视频学习 App 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 基于 PRD 原型实现一个可直接运行的 React 前端 MVP，打通家长内容管理、儿童选课播放、进度保存和学习反馈闭环。

**架构：** 使用 Vite + React + TypeScript 单应用，以 URL 路由区分家长端和儿童端。领域数据由 `AppStore` 统一维护并持久化到 `localStorage`，页面只通过 store 的明确操作读写数据；上传使用浏览器端模拟队列，播放器用可控的演示时钟模拟 MP4 播放进度。

**技术栈：** React 18、TypeScript、Vite、React Router、Vitest、Testing Library、原生 CSS、Playwright。

---

## 文件结构

### 基础与领域层

- 创建：`package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`src/main.tsx`
  - 初始化 Vite、测试脚本、应用入口和测试环境。
- 创建：`src/types/domain.ts`
  - 定义 Child、Subject、Course、Video、WatchProgress、WatchEvent、Favorite、UploadTask 及状态枚举。
- 创建：`src/data/seed.ts`
  - 提供与 PRD 原型一致的中文演示数据、学科色彩、头像和课程封面插画参数。
- 创建：`src/lib/storage.ts`
  - 负责 localStorage 的版本化读取、写入、重置和 JSON 容错。
- 创建：`src/lib/domain.ts`
  - 放置自然排序、课程进度、完成判定、有效观看累计、连续学习天数和筛选聚合等纯函数。
- 创建：`src/context/AppStore.tsx`
  - 提供 React Context、当前孩子、课程/视频/孩子/进度的查询与命令操作。

### 共享界面层

- 创建：`src/components/Icon.tsx`
  - 使用内联 SVG 绘制导航、播放、统计和操作图标，避免引入与 PRD 不一致的图标库。
- 创建：`src/components/StatusBadge.tsx`、`src/components/ProgressBar.tsx`、`src/components/EmptyState.tsx`、`src/components/Modal.tsx`
  - 复用状态胶囊、进度条、空状态和表单弹层。
- 创建：`src/components/ParentShell.tsx`、`src/components/ChildShell.tsx`
  - 分别实现 PRD 的桌面左侧导航/顶部工具栏和儿童端手机框架/底部三栏导航。
- 创建：`src/styles/tokens.css`、`src/styles/global.css`
  - 定义原型蓝、深藏蓝、完成绿、四学科色、圆角、阴影、桌面栅格和儿童端窄屏规则。
- 修改：`src/App.tsx`
  - 注册所有父端和儿童端路由、端间预览入口及未匹配路由回退。

### 家长端页面

- 创建：`src/features/parent/OverviewPage.tsx`
  - 实现四指标卡、最近上传课程、近 7 天孩子学习对比和最近学习动态。
- 创建：`src/features/parent/CoursesPage.tsx`、`src/features/parent/CourseEditor.tsx`、`src/features/parent/CourseDetail.tsx`
  - 实现搜索/筛选、课程表格、新建/编辑抽屉、视频排序、发布和下架确认。
- 创建：`src/features/parent/UploadsPage.tsx`
  - 实现多文件选择/拖拽、格式校验、自然排序、逐文件模拟进度、取消和重试。
- 创建：`src/features/parent/ChildrenPage.tsx`、`src/features/parent/ChildEditor.tsx`
  - 实现孩子卡片、新增/编辑、停用确认和进入记录。
- 创建：`src/features/parent/RecordsPage.tsx`
  - 实现孩子/时间/学科筛选、统计卡、CSS 趋势图和明细表。
- 创建：`src/features/parent/SettingsPage.tsx`
  - 实现本地数据存储统计、偏好开关和恢复演示数据入口。

### 儿童端页面

- 创建：`src/features/child/SelectChildPage.tsx`
  - 实现头像选择、无孩子空状态和家长入口。
- 创建：`src/features/child/HomePage.tsx`
  - 实现问候区、继续学习、学科分类和我的课程。
- 创建：`src/features/child/CoursesPage.tsx`、`src/features/child/CoursePage.tsx`
  - 实现课程筛选、课程头部、Tab、分集列表和自由选集。
- 创建：`src/features/child/WatchPage.tsx`
  - 实现演示播放器、播放/暂停、时间轴、快退/快进、倍速、上下集、收藏、心跳保存和退出保存。
- 创建：`src/features/child/RecordsPage.tsx`
  - 实现儿童侧统计/历史切换、三项统计卡、趋势图和动态列表。
- 创建：`src/features/child/MePage.tsx`
  - 实现个人统计、分组入口、切换孩子和护眼模式。

### 测试与说明

- 创建：`src/lib/domain.test.ts`
  - 覆盖核心业务规则纯函数。
- 创建：`src/context/AppStore.test.tsx`
  - 覆盖孩子隔离、课程发布、下架保留历史和进度写入。
- 创建：`tests/e2e/family-learning.spec.ts`
  - 使用 Playwright 覆盖家长创建课程、儿童播放、继续学习、切换孩子和下架场景。
- 创建：`tests/fixtures/demo-lesson.mp4`
  - 仅用于前端扩展名校验和模拟上传队列，不作为真实可播放媒体。
- 创建：`README.md`（修改现有标题文件）
  - 说明启动命令、演示账号入口、路由、数据重置方式和 MVP 限制。

### 任务 1：初始化 Vite 应用与测试基线

**文件：**
- 创建：`package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`src/main.tsx`、`src/App.tsx`
- 测试：`src/App.test.tsx`

- [ ] **步骤 1：写入最小项目配置**

添加脚本：`dev` 使用 `vite`，`build` 使用 `tsc -b && vite build`，`test` 使用 `vitest run`，`test:e2e` 使用 `playwright test`；依赖使用 React、React DOM、React Router，开发依赖使用 Vite、TypeScript、Vitest、jsdom、Testing Library 和 Playwright。

- [ ] **步骤 2：安装依赖并确认命令可用**

运行：`npm install`

预期：生成 `node_modules` 和锁文件，命令退出码为 0。

- [ ] **步骤 3：编写失败测试确认测试环境**

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';

it('renders the product shell', () => {
  render(<App />);
  expect(screen.getByText('小小学习星球')).toBeInTheDocument();
});
```

- [ ] **步骤 4：运行测试确认失败**

运行：`npm test -- --run src/App.test.tsx`

预期：FAIL，原因是 `src/App.tsx` 尚未渲染“小小学习星球”。

- [ ] **步骤 5：实现最小入口和回退页面**

`src/main.tsx` 创建 `ReactDOM.createRoot(...).render(<App />)`；`src/App.tsx` 返回带产品名和“进入儿童端 / 进入家长端”两个链接的最小容器。

- [ ] **步骤 6：运行测试与构建确认通过**

运行：`npm test -- --run src/App.test.tsx` 和 `npm run build`

预期：测试 PASS，构建生成 `dist` 且退出码为 0。

- [ ] **步骤 7：Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src
git commit -m "chore: initialize learning app frontend"
```

### 任务 2：实现领域模型、本地存储和业务规则

**文件：**
- 创建：`src/types/domain.ts`、`src/data/seed.ts`、`src/lib/storage.ts`、`src/lib/domain.ts`
- 测试：`src/lib/domain.test.ts`

- [ ] **步骤 1：编写业务规则失败测试**

测试至少覆盖：`naturalCompare('第10课','第2课')` 结果为正；只有 READY 视频才能通过发布校验；最大进度从 95% 写入 30% 后仍为 95%；90% 判定完成；课程进度按完成视频数计算；不同 childId 的进度互不影响；暂停状态不累计有效时长；每日达到 60 秒计入连续学习。

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- --run src/lib/domain.test.ts`

预期：FAIL，原因是领域类型和函数尚未定义。

- [ ] **步骤 3：实现类型和纯函数**

实现 `createProgressUpdate(previous, input)` 时遵守：`lastPosition` 使用本次有效位置，`maxProgress` 使用 `Math.max(previous.maxProgress, input.progress)`，`completed` 根据更新后的最大进度与常量 `COMPLETION_THRESHOLD = 0.9` 判定；`addWatchEvent` 仅在 `isPlaying === true` 且 `deltaWatchSeconds > 0` 时创建事件。

- [ ] **步骤 4：实现版本化 seed 存储**

`storage.ts` 使用键 `family-learning-app:v1`。读取不到数据时写入 `seed.ts`，JSON 解析失败时恢复 seed；`resetStorage()` 只清除这一键并立即重新初始化，不触碰其他 localStorage 数据。

- [ ] **步骤 5：运行领域测试确认通过**

运行：`npm test -- --run src/lib/domain.test.ts`

预期：所有业务规则测试 PASS。

- [ ] **步骤 6：Commit**

```bash
git add src/types src/data src/lib
git commit -m "feat: add learning domain rules and storage"
```

### 任务 3：实现 AppStore 和共享视觉基础

**文件：**
- 创建：`src/context/AppStore.tsx`、`src/components/Icon.tsx`、`src/components/StatusBadge.tsx`、`src/components/ProgressBar.tsx`、`src/components/EmptyState.tsx`、`src/components/Modal.tsx`
- 创建：`src/components/ParentShell.tsx`、`src/components/ChildShell.tsx`、`src/styles/tokens.css`、`src/styles/global.css`
- 修改：`src/main.tsx`、`src/App.tsx`
- 测试：`src/context/AppStore.test.tsx`

- [ ] **步骤 1：编写 store 行为失败测试**

测试 `createCourse` 默认生成 DRAFT；`publishCourse` 在没有 READY 视频时返回校验错误；`addVideo` 生成自然排序的 `orderIndex`；`selectChild` 只改变当前儿童端作用域；`saveWatchProgress` 只更新当前 childId/videoId 组合；`offlineCourse` 不删除 watchEvents。

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- --run src/context/AppStore.test.tsx`

预期：FAIL，原因是 `AppStoreProvider` 和命令方法尚未定义。

- [ ] **步骤 3：实现 AppStore**

Provider 初始化 `loadSnapshot()`，每次命令操作后使用 `persistSnapshot()`；暴露 `currentChildId`、`setCurrentChild`、`courses`、`videos`、`children`、`progress`、`watchEvents` 及课程/视频/孩子/进度命令，所有儿童查询必须通过当前 childId 过滤。

- [ ] **步骤 4：实现共享组件和视觉 tokens**

在 tokens 中定义 `--blue: #2d86f5`、`--navy: #0b235a`、`--sky: #eff7ff`、`--green: #35c98b`、`--red: #ff6c66`、`--yellow: #ffbd3f`、`--purple: #7f6cf4`；共享组件使用 12～20px 圆角、细蓝灰边框和轻阴影。Icon 只输出内联 SVG，统一 stroke 宽度。

- [ ] **步骤 5：实现双端壳层和基础路由**

`ParentShell` 固定左侧导航和顶栏；`ChildShell` 使用最大宽度 390px 的手机画布、浅蓝背景、底部固定三栏导航。App 先注册路由占位页，使所有计划路径可访问。

- [ ] **步骤 6：运行测试确认通过并检查构建**

运行：`npm test -- --run src/context/AppStore.test.tsx` 和 `npm run build`

预期：store 测试 PASS，构建 PASS。

- [ ] **步骤 7：Commit**

```bash
git add src/context src/components src/styles src/main.tsx src/App.tsx
git commit -m "feat: add shared shells and app store"
```

### 任务 4：实现家长端概览、课程、上传、孩子和设置

**文件：**
- 创建：`src/features/parent/OverviewPage.tsx`
- 创建：`src/features/parent/CoursesPage.tsx`、`src/features/parent/CourseEditor.tsx`、`src/features/parent/CourseDetail.tsx`
- 创建：`src/features/parent/UploadsPage.tsx`
- 创建：`src/features/parent/ChildrenPage.tsx`、`src/features/parent/ChildEditor.tsx`
- 创建：`src/features/parent/RecordsPage.tsx`、`src/features/parent/SettingsPage.tsx`

- [ ] **步骤 1：实现概览页面**

从 store 聚合课程、READY 视频、启用孩子和今日 watchEvents；按 PRD 原型实现四指标卡、最近上传列表、近 7 天柱状图和最近动态；没有课程或记录时使用 `EmptyState`，不写死示例统计。

- [ ] **步骤 2：实现课程列表与筛选**

使用受控 `search/subject/age/status` 状态；列表字段固定为封面、课程名称、学科、适龄/年级、视频数、更新时间、状态、操作；发布状态使用 `StatusBadge`，操作包含编辑、查看、发布/下架。

- [ ] **步骤 3：实现课程编辑与详情**

编辑抽屉提交课程名称、封面样式、学科、适龄范围和简介；详情显示视频列表并提供上移/下移；发布调用 store 校验并在抽屉内显示失败原因；下架使用确认弹层且文案说明历史记录保留。

- [ ] **步骤 4：实现视频上传队列**

监听 `input[type=file]` 和 drop 事件，只接受 `.mp4`/`.mov`；每个文件先生成 `UploadTask`，按自然文件名排序，使用 120ms 定时器每次增加 10%～18% 进度；失败任务可重试，等待中/上传中任务可取消，完成任务写入 READY 视频。

- [ ] **步骤 5：实现孩子管理**

展示头像、昵称、年级、可见课程数、最近学习时间；新增/编辑抽屉校验昵称非空；停用使用确认弹层，停用后从儿童选择页隐藏但不删除历史记录。

- [ ] **步骤 6：实现学习记录与设置**

学习记录的图表和明细共享同一组筛选状态；设置页面从 `JSON.stringify(snapshot).length` 估算本地数据占用，提供允许自由选课和护眼模式开关，以及“恢复演示数据”按钮。

- [ ] **步骤 7：运行构建并手动验收家长路径**

运行：`npm run build`；启动：`npm run dev -- --host 127.0.0.1`

验收：概览进入新增课程；课程列表能创建草稿、添加视频并发布；上传队列独立反馈；孩子管理能新增两个孩子；学习记录筛选会更新统计和表格。

- [ ] **步骤 8：Commit**

```bash
git add src/features/parent
git commit -m "feat: build parent management workspace"
```

### 任务 5：实现儿童端选择孩子、首页、课程和我的

**文件：**
- 创建：`src/features/child/SelectChildPage.tsx`
- 创建：`src/features/child/HomePage.tsx`
- 创建：`src/features/child/CoursesPage.tsx`、`src/features/child/CoursePage.tsx`
- 创建：`src/features/child/MePage.tsx`

- [ ] **步骤 1：实现选择孩子页**

启用孩子以头像卡片排列，点击调用 `setCurrentChild` 并进入 `/child/home`；无孩子时展示引导；底部“家长入口”链接到 `/parent/overview`。

- [ ] **步骤 2：实现儿童首页**

问候语显示当前孩子昵称；继续学习用 `getContinueLearning(currentChildId)` 取最近未完成视频，点击直达播放器；学科入口带 query 参数进入课程列表；我的课程只显示 PUBLISHED 课程并显示课程进度。

- [ ] **步骤 3：实现课程列表与详情**

课程列表按学科 query 过滤；详情头部显示封面、标题、学科、适龄、总集数和课程完成度；Tab 在“课程目录/课程介绍”之间切换；目录显示播放按钮、集数、标题、时长和完成/进度状态，所有 READY 视频可直接进入。

- [ ] **步骤 4：实现我的页面**

显示当前孩子头像、年级、已学课程、完成视频、学习天数；入口进入我的课程、学习记录、收藏和切换孩子；护眼模式写入 localStorage 并在 `ChildShell` 加上 `eye-care` class；不显示课程编辑、删除或服务器管理入口。

- [ ] **步骤 5：按 PRD 原型完成儿童端 CSS**

页面使用浅蓝背景、圆角白卡、蓝色主按钮、深藏蓝标题、底部三栏导航；首页学科入口使用四种色块；选择孩子页使用 CSS 山丘与云朵背景；窄屏宽度控制在 390px，桌面预览居中显示。

- [ ] **步骤 6：运行构建并手动验收儿童浏览路径**

运行：`npm run build`；验收：选择孩子后首页显示孩子数据；学科和课程卡可进入详情；切换孩子后页面统计变化；护眼开关刷新后仍保持。

- [ ] **步骤 7：Commit**

```bash
git add src/features/child
git commit -m "feat: build child learning experience"
```

### 任务 6：实现演示播放器和进度闭环

**文件：**
- 创建：`src/features/child/WatchPage.tsx`
- 修改：`src/lib/domain.ts`、`src/context/AppStore.tsx`、`src/features/child/HomePage.tsx`、`src/features/child/CoursePage.tsx`
- 测试：扩展 `src/lib/domain.test.ts`、`src/context/AppStore.test.tsx`

- [ ] **步骤 1：编写播放器规则失败测试**

测试播放状态每 10 秒写入一个事件；暂停后连续 10 秒不增加 `totalWatchSeconds`；退出保存 `lastPosition`；进度到 90% 时 `completed` 为 true；回看时最大进度不下降；下一集切换前保留当前进度。

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- --run src/lib/domain.test.ts src/context/AppStore.test.tsx`

预期：新增播放器测试 FAIL。

- [ ] **步骤 3：实现演示播放器时钟**

WatchPage 使用 `isPlaying`、`positionSeconds`、`playbackRate`、`lastHeartbeatAt` 状态；播放时每秒递增 `positionSeconds`；每累计 10 秒调用一次 `saveWatchProgress`，传入 `deltaWatchSeconds = 10`；暂停、组件卸载、点击上下集和返回时调用一次 `flushProgress()`。

- [ ] **步骤 4：实现播放器控件**

进度条允许自由拖动；快退/快进限制在 `0` 到 `duration`；倍速为 0.75x、1.0x、1.25x、1.5x、2.0x；到达结尾或 90% 自动完成；上一集/下一集使用当前课程排序，不存在时按钮禁用。

- [ ] **步骤 5：接入继续学习和课程状态**

首页重新读取最近未完成视频；课程详情在返回时从 store 重新计算视频状态和课程进度；播放页顶部、视频不存在和课程下架状态提供明确提示及返回入口。

- [ ] **步骤 6：运行测试与构建确认通过**

运行：`npm test -- --run src/lib/domain.test.ts src/context/AppStore.test.tsx` 和 `npm run build`

预期：测试 PASS，构建 PASS。

- [ ] **步骤 7：Commit**

```bash
git add src/features/child/WatchPage.tsx src/lib/domain.ts src/context/AppStore.tsx src/features/child/HomePage.tsx src/features/child/CoursePage.tsx
git commit -m "feat: add resumable learning playback"
```

### 任务 7：实现儿童学习记录、浏览器验收和项目说明

**文件：**
- 创建：`src/features/child/RecordsPage.tsx`
- 创建：`tests/e2e/family-learning.spec.ts`
- 修改：`README.md`

- [ ] **步骤 1：实现儿童学习记录页**

使用当前 childId 聚合今日学习、本周完成、连续学习天数；“学习统计/学习历史”切换只改变内容区；动态列表按时间倒序；空状态显示“今天从喜欢的课程开始吧”。

- [ ] **步骤 2：编写端到端验收场景**

Playwright 场景按以下顺序操作：打开 `/parent/overview`；创建课程；进入 `/parent/uploads` 选择 `tests/fixtures/demo-lesson.mp4`，选择所属课程并等待任务完成；回到课程管理发布课程；打开 `/child/select` 选择哥哥；进入课程详情并播放到至少 90%；回到首页检查继续学习区域更新；选择妹妹确认她的同一视频未继承哥哥进度；回到家长端下架课程，确认儿童课程列表隐藏而学习记录保留。

创建：`tests/fixtures/demo-lesson.mp4`

该 fixture 只用于验证扩展名校验和模拟上传队列，不作为可播放媒体；播放器在没有真实媒体地址时使用同样的演示时钟和控制 UI。

- [ ] **步骤 3：运行端到端测试确认失败或暴露问题**

先运行：`npx playwright test tests/e2e/family-learning.spec.ts --headed=false`

预期：若页面尚未完全接线，测试会报告具体选择器或路由问题；根据失败信息逐项修复，不修改验收目标。

- [ ] **步骤 4：补充 README**

记录 `npm install`、`npm run dev`、`npm test`、`npm run build` 和 `npx playwright test`；说明这是 localStorage 前端 MVP、如何从设置恢复演示数据、父端/儿童端路由和未接入真实服务器的范围。

- [ ] **步骤 5：运行完整验证**

运行：`npm test`、`npm run build`、`npx playwright test tests/e2e/family-learning.spec.ts --headed=false`

预期：单元测试、构建和端到端测试全部 PASS；浏览器控制台无 error；桌面父端和 390px 儿童端截图布局与 PRD 原型层级一致。

- [ ] **步骤 6：Commit**

```bash
git add src/features/child/RecordsPage.tsx tests/e2e/family-learning.spec.ts README.md
git commit -m "test: verify family learning app flow"
```

## 计划自检

- PRD 的家长端六个模块分别覆盖在任务 4；儿童端六个页面覆盖在任务 5～7。
- 课程草稿/发布/下架、视频 READY/FAILED、90% 完成判定、断点续播、有效学习时长、孩子隔离和历史保留均有对应领域测试或浏览器验收。
- 视觉要求集中在任务 3、4、5，并在任务 7 使用桌面与 390px 截图验收。
- 计划没有依赖真实后端、真实视频文件或未定义的服务；所有函数、文件和命令均在任务中明确。
- 计划没有未指定的占位操作。
