# KotobaFlow Android 源码

这是 KotobaFlow 的独立 Android 工程，使用 Capacitor 原生壳和本机网页运行时，提供离线学习、包内音频、学习存档文件导入导出与手机阅读界面。

[网站](https://kotobaflow.lol) · [Android 0.4.2 正式版下载（约 827 MB）](https://download.kotobaflow.lol/android/kotobaflow-0.4.2-public-8d85707591da.apk)

Android 最低要求为 Android 7.0。下载的是完整 APK，包含 KotobaFlow 四册、77 课与古典拓展阅读，应用保持离线使用。已安装开发签名测试版时，请先导出学习存档，再卸载旧版、安装正式版。

APK：`0.4.2-public` / versionCode `3`，826,752,298 bytes。

SHA-256：`8d85707591da836322374984626307856c6aed47922d68890a337a885e6338e9`。

[Web 源码](https://github.com/greyindex/kotobaflow-web)

## 发行版对应关系

本次公开源码对应已发布 APK 的外层提交 `5b390650a5f6b5f2a31e688420887bd0f63f83de`，内层网页提交 `c704ecffb3eae5ce24c65704a331f972ab081bc6`。内层网页源码位于 `web-source-backup/`，在此公开仓库中作为普通目录一并跟踪，不再依赖一个未上传的嵌套 Git 仓库。

签名证书 SHA-256：`83527b6445215f1ed24463b59e0342378b47bfc76e299394deefac80fb7565f0`。仓库不包含签名私钥，也不能生成能覆盖正式版安装的同签名 APK。

## 目录

| 路径 | 职责 |
| --- | --- |
| `android/` | 原生文件桥、资源 Range 请求、导航与屏幕策略、Gradle 工程和单元测试 |
| `runtime/` | 移动布局、本机进度适配、阅读控制和运行时注入 |
| `scripts/` | 资源白名单、离线转换、完整性检查、构建与设备验收 |
| `web-source-backup/` | 本发行版独立维护的网页程序源码 |
| `mobile-assets/logo.svg` | 项目标识源文件 |

网页业务与移动差异在本仓库独立维护；不会自动同步 Web 仓库之后的改动。

## 构建前提

Node.js 22+、Python 3.11+、Pillow、JDK 21、Android SDK 36。最低运行 Android API 24。

本仓库按 [公开范围检查](PUBLICATION.md) 排除了课程 JSON、词库、全部音频、教材图片、古典资料、截图和私有 Git 历史。程序代码与 APK 对应，但资源不齐全，克隆后不能直接重建完整 APK；必须另行准备有权使用且符合原 manifest/hash 契约的资源。源码清单可单独验证：

```powershell
npm ci
python scripts/check-public-source.py
```

补齐资源后，公开版使用 `npm run apk:public` 或 `npm run apk:public:release`，验收使用 `npm run check:public`。默认 `npm run apk` 是本地八册配置，仍依赖未公开的新编资源。构建不会从网站自动下载缺失内容。

正式签名只读取本机未跟踪的 `android/keystore.properties`。自建包应使用自己的签名；换签名安装前先导出学习存档。

## 许可

本次只公开源码，不替权利人授予新的开源许可。第三方声明见 `resources/licenses/` 及内层同名目录，完整范围见 [PUBLICATION.md](PUBLICATION.md)。
