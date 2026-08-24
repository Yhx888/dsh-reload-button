# dsh-reload-button

左侧栏"设置"按钮旁的重载按钮：一键重启 dsh 后端，**窗口保持打开**，重载期间显示**高斯模糊遮罩 + DeepSeek 鲸鱼图标**，后端恢复后自动回到原界面。

## 功能

- **重载按钮**：注入在左下角侧边栏底部"检查更新 / 远程访问"那一行的右侧（设置按钮上一行；锚点 = ui-settings 的 `settings.trigger` 插槽，图标 = 环形刷新箭头），点击即触发。
- **高斯模糊遮罩**：立即全屏盖住界面（`backdrop-filter: blur(14px)`），中央为 DeepSeek 鲸鱼（呼吸动画），文案"正在重载 DeepSeek Harness"。
- **恢复自愈**：轮询 `/api/dsh-reload-button/ping` 直到后端恢复；旧页面自动 `location.reload()` 拿最新 bundle，已 reload 的新页面直接收尾；跨 reload 状态存 localStorage（`dsh-reload-button:pending`）。
- **窗口不断**：重启由 host 半以"延迟自杀"方式调度（先回 200 → 900ms 后 `systemctl kill -s SIGKILL dsh-web.service`，systemd `Restart=on-failure` 3 秒后自动拉起，全程约 4~6 秒），Electron 桌面壳窗口全程保持打开。

## 安装

```bash
# profile 注册（link: 依赖），然后重启 dsh web
pnpm install   # 在 ~/.dsh/profiles/web 下
```

装配行已写入 `dsh.profile.bundles`；`cordis.patch.yml` 为 loader 挂载声明。

## API（host 半，全部 loopback-only）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/dsh-reload-button/reload` | 请求后端重启（先回 200，延迟调度） |
| GET/POST | `/api/dsh-reload-button/ping` | 健康探测（恢复轮询） |
| GET | `/api/dsh-reload-button/whale.svg` | 遮罩鲸鱼图标 |

## 说明与边界

- 重启目标是 WSL systemd 服务 `dsh-web.service`（3080 主环境）。
- **为什么是 SIGKILL 而不是 `systemctl restart`**：实测 dsh 优雅退出（SIGTERM）在有活跃连接时会卡住 90 秒（systemd 默认 TimeoutStopSec 判超时强杀，日志 `State 'stop-sigterm' timed out`），表现为"重启卡很久"。SIGKILL 快速路径与超时兜底最终路径等价，只是不再空等 90 秒；会话持久化逐事件落盘，无额外丢失风险。
- 非 systemd 环境（如临时调试实例）会因 `systemctl` 不存在而只记录警告、不实际重启——按钮与遮罩流程仍走通，服务需手动恢复。
- **按钮持久性**：侧边栏底部是 React 渲染，折叠/切换会清掉注入的原生按钮——client 半用「持久 MutationObserver + 3s 轮询」有缺即补，按钮不会消失。
- 等待超时 120 秒后自动退出遮罩并清标记（此时应手动检查服务）。

## 与 dsh-auto-resume 的联动

点击重载按钮 = **显式请求"重启后自动续接"**：

1. reload-button 点击时向 localStorage 写入联动标记 `dsh-auto-resume:resume-request`（`{ts}`）；
2. dsh-auto-resume 在后端恢复后**优先消费该标记**（页面 reload 也不丢），对被打断的会话自动提交【自动续接】消息；
3. 非按钮触发的重启（如 agent 端 `systemctl restart`）由 dsh-auto-resume 的断连检测（`dsh-auto-resume:disconnected`）兜底。

## License

MIT