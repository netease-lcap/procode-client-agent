# ProCode client Wave 插件

此目录包含 Skill、管理脚本和带校验的 client 安装包，不使用 MODS。不要只复制 SKILL.md。

解压保留此目录后，在本机运行以下命令注册本地市场并安装，再在 Wave 桌面端已有会话重载插件：

    wave plugin marketplace add "/绝对路径/本插件目录"
    wave plugin install procode-client-agent@procode-client-local

市场清单位于根目录，插件位于 plugin/，二者不可混放在同一个 .wave-plugin/。也可用 wave --plugin-dir "/绝对路径/本插件目录/plugin" 验证插件发现。Skill 名称为 procode-client，最终调用名以 Wave 技能列表显示为准。

Skill 中的管理脚本支持 start/status/connect/stop，先查已有服务再启动。启动或复用成功后，Skill 使用返回的 workdir 和 interactionUrl，以 Markdown 回复工作目录和可点击的交互页面地址，不使用 MODS、不要求手动输入连接文件。首次启动将按 CLI 规则整理应用目录，请不要在 procode 源码仓库执行。

Node.js >=22.13 和可用 npm 是前提；tgz 安装到用户私有缓存，不全局安装。缺失的 npm 依赖和 OpenCode 可能需要联网下载，这不是离线包。桌面端可能不继承终端环境，可通过 --env-file 指定私有 JSON 配置。不得把模型密钥或连接文件内容粘贴到对话；仅按用户请求展示本次本地交互链接，不公开分享其认证参数。

默认不打开浏览器，显式 --open 才请求打开；--rerun 强制重跑。停止操作需显式 --connection-file；关闭页面不会停止独立 CLI。状态回执与验收结果不同，停止不会回滚文件，也不保证派生进程全部停止。

运行包保留原有压缩混淆策略，不分发 sourcemap 与声明文件。
