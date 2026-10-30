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

| 路径                     | 职责                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| `android/`               | 原生文件桥、资源 Range 请求、导航与屏幕策略、Gradle 工程和单元测试 |
| `runtime/`               | 移动布局、本机进度适配、阅读控制和运行时注入                       |
| `scripts/`               | 资源白名单、离线转换、完整性检查、构建与设备验收                   |
| `web-source-backup/`     | 本发行版独立维护的网页程序源码                                     |
| `mobile-assets/logo.svg` | 项目标识源文件                                                     |

网页业务与移动差异在本仓库独立维护；不会自动同步 Web 仓库之后的改动。

## 构建前提

Node.js 22+、Python 3.12+、Pillow、JDK 21、Android SDK 36。最低运行 Android API 24。

数据母版、处理后的课程／词库／语法、古典资料及全部公开音图依赖集中在 [KotobaFlow 资源仓库](https://github.com/greyindex/kotobaflow-resources)。使用 `android-0.4.2` 资源版本，安装到本仓库的独立网页源码目录：

```powershell
git clone https://github.com/greyindex/kotobaflow-resources.git
python kotobaflow-resources/install_resources.py --profile android-0.4.2 --target C:\path\to\kotobaflow-android\web-source-backup
cd C:\path\to\kotobaflow-android
npm ci
npm --prefix web-source-backup ci
python scripts/check-public-source.py
npm run web:prepare:public
npm run verify
```

资源仓库不含新编专用资料；项目自有资源采用 CC0，第三方资料保留原署名与许可，资源问题联系其 README 中的邮箱。媒体由资源仓库的 Release 提供，安装器逐文件校验，不需要把数据或私钥提交到本源码仓库。

公开版构建使用 `npm run apk:public` 或 `npm run apk:public:release`，对应验收为 `npm run check:public`。公开版使用哈希指纹检查不可公开文本，无需取得新编正文。默认 `npm run apk` 仍是原本地八册配置，需要未公开的新编资源；两种版本不要混用。

正式签名只读取本机未跟踪的 `android/keystore.properties`。自建包应使用自己的签名；换签名安装前先导出学习存档。

## 许可

本次只公开源码，不替权利人授予新的开源许可。第三方声明见 `resources/licenses/` 及内层同名目录，完整范围见 [PUBLICATION.md](PUBLICATION.md)。
