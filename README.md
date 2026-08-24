# dsh-reload-button

左侧栏"设置"按钮旁的重载按钮：一键重启 dsh 后端，**窗口保持打开**，重载期间显示**高斯模糊遮罩 + DeepSeek 鲸鱼图标**，后端恢复后自动回到原界面。

## 功能

- **重载按钮**：注入在左下角"设置"按钮右侧（图标 = 环形刷新箭头），点击即触发。
- **高斯模糊遮罩**：立即全屏盖住界面（`backdrop-filter: blur(14px)`），中央为 DeepSeek 鲸鱼（呼吸动画），文案"正在重载 DeepSeek Harness"。
- **恢复自愈**：轮询 `/api/dsh-reload-button/ping` 直到后端恢复；旧页面自动 `location.reload()` 拿最新 bundle，已 reload 的新页面直接收尾；跨 reload 状态存 localStorage（`dsh-reload-button:pending`）。
- **窗口不断**：重启由 host 半以"延迟自杀"方式调度（先回 200 → 900ms 后 `systemctl restart dsh-web.service`），Electron 桌面壳窗口全程保持打开。

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

- 重启目标是 WSL systemd 服务 `dsh-web.service`（3080 主环境）。非 systemd 环境（如临时调试实例）会因 `systemctl` 不存在而只记录警告、不实际重启——按钮与遮罩流程仍走通，服务需手动恢复。
- 等待超时 120 秒后自动退出遮罩并清标记（此时应手动检查服务）。
- 与 dsh-auto-resume 配合：重载完成后由它自动续接被打断的对话。

## License

MIT