# 家庭学习视频 App

一个面向家庭的前端学习空间 MVP：家长管理课程和视频，孩子按自己的档案浏览、观看并保存学习进度。

## 快速开始

```bash
npm install
npm run dev
```

开发服务器启动后访问 <http://localhost:5173>。

常用校验命令：

```bash
npm test
npm run build
npx playwright test
```

Playwright 默认以无头模式运行；需要查看浏览器时可使用 `npx playwright test --headed`。

## 演示流程

- 家长端从 `/parent/overview` 进入概览，可创建课程、在 `/parent/uploads` 上传视频、回到 `/parent/courses` 发布或下架课程。
- 儿童端从 `/child/select` 选择“哥哥”或“妹妹”，然后进入 `/child/home`、`/child/courses`、`/child/me` 和 `/child/records`。
- `/child/records` 的学习统计和学习历史按当前选择的孩子隔离；课程下架后，儿童课程列表隐藏，但已有学习记录保留。
- 设置页 `/parent/settings` 的“恢复演示数据”会重置当前 MVP 数据，便于重新演示。

## MVP 范围与限制

- 数据使用浏览器 `localStorage` 保存，键名为 `family-learning-app:v1`；没有登录、权限、多设备同步或真实数据库。
- 上传队列只校验 MP4/MOV 扩展名并模拟进度，`tests/fixtures/demo-lesson.mp4` 仅用于测试队列，不是真实可播放媒体。
- 播放器使用演示时钟和可拖动时间轴保存进度，90% 视为完成；尚未接入真实视频 CDN、转码服务或媒体服务器。
- 当前版本是单机前端演示，不包含真实服务器 API、云端文件存储、消息通知和生产环境安全能力。
