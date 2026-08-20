# luci-app-frpc

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/juzijia/luci-app-frpc?color=brightgreen)](https://github.com/juzijia/luci-app-frpc/releases)

> [English](README.en.md) | **简体中文**

适用于 OpenWrt / ImmortalWrt 的 FRPC LuCI 管理界面。

本项目是 LuCI 管理界面及 OpenWrt / ImmortalWrt 集成项目，不是 FRP Core 的 fork 或重新分发项目。本项目不包含、不分发 FRP Core；FRP Core 请从 [FRP 官方仓库（fatedier/frp）](https://github.com/fatedier/frp) 获取。

## 安装

本项目提供 LuCI 管理界面，不包含、不分发 FRPC Core 二进制。

从 [Releases](https://github.com/juzijia/luci-app-frpc/releases) 下载：

- `luci-app-frpc-advanced_*.ipk`
- `luci-i18n-frpc-advanced-zh-cn_*.ipk`

```sh
opkg install luci-app-frpc-advanced_*.ipk
opkg install luci-i18n-frpc-advanced-zh-cn_*.ipk
```

## 说明

- LuCI 包架构：`all`
- FRPC Core 与 LuCI 界面解耦
- 适用于 OpenWrt / ImmortalWrt

## License

本项目采用 [MIT License](LICENSE) 许可。
