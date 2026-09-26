# Research Experiment Web

一个本地运行的研究记录工作台：按问题、实验、结果和结论浏览，通过证据关系追溯来源。前端目前以中文呈现。

A local research workbench for questions, experiments, runs, results and evidence-linked conclusions. The public checkout includes **fictional demonstration data only**. No real research dataset is distributed.

## 快速开始

需要 Node.js 24 或更新版本；没有第三方运行时依赖，无需 npm install。

~~~powershell
git clone https://github.com/JesseBob-FD/Research-Experiment-Web.git
cd Research-Experiment-Web
node src/cli.mjs serve --open
~~~

打开 http://127.0.0.1:4317 。Windows 也可双击 Start-Workbench.cmd；保留启动窗口。Stop-Workbench.cmd 可停止服务。非 Windows 系统使用 serve 后手动打开浏览器，不使用 --open。

首次启动会导入虚构演示：2 个问题、1 个实验、1 次运行、2 条结果、2 条结论。演示数值不能用于科学或性能判断。数据库保存在 data/research.sqlite3，日志保存在 runtime/。

## 已有能力与边界

- 问题、实验、结果、结论四个视图；按研究集合、问题、方法、状态和文字筛选。
- 运行及多对多证据关联；原始图表、CSV 精确值、列筛选与分页。
- 文件指纹检查；CLI 批量登记、事务回滚和基于版本号的更新冲突检测。
- 浏览器接口只读，服务仅绑定本机回环地址。

这仍是初始版本。skill 是基础记录规范，不是经过充分评估的自动科研总结器。人工 GUI 编辑、完整的结论修订流程和批量历史文档理解尚未实现。来源指纹检查不等于对科学结论的验证。

## 连接自己的研究工作区

在首次启动前，新建 local/workspace.json，例如：

~~~json
{
  "workspaceRoot": "..",
  "title": "我的研究空间"
}
~~~

workspaceRoot 相对于工具根目录，也可以是绝对路径。选择真实研究文件所在的目录；工具只读取该范围内登记的文件。若工具位于研究目录内部，来源读取会排除工具自身。未配置本地工作区的干净副本使用 examples/demo-workspace。

配置后不会自动扫描、分析或上传研究文件。没有 adapter 时，用 record 命令登记记录。数据模式切换必须使用独立数据库（--db data/my-research.sqlite3），或在停止服务并备份演示数据库后另建数据库；不要把演示记录当成真实研究。

需要项目专属导入器时，可将可信的本地模块放到 local/，并添加配置项 "adapter": "local/importer.mjs"。模块导出 importWorkspace(db)，可调用 src/store.mjs 的存储函数。适配器是本地执行代码，能够访问运行用户的权限；只使用你信任的适配器。真实研究摘要和适配逻辑保留在 local/，不提交到公共仓库。

## 命令与记录规范

在工具根目录运行：

~~~powershell
node src/cli.mjs serve
node src/cli.mjs import
node src/cli.mjs check
node src/cli.mjs export
node src/cli.mjs record data/record.json
node src/cli.mjs stop
~~~

serve 支持 --port 4318；命令支持 --db data/other.sqlite3。export 写入 data/export.json。当前 stop 使用 runtime/server.json 中最近启动的服务信息；多个实例应使用独立工具副本。

record 接收 entities、edges 和可选 sourcePaths。最小批次示例：

~~~json
{
  "entities": [
    {"id":"q-new","type":"question","title":"要检验什么？","summary":"明确问题和判断标准。","sources":[]}
  ],
  "edges": [],
  "sourcePaths": []
}
~~~

实体类型：question、experiment、run、result、conclusion。ID 只使用字母、数字、连字符或下划线。

| 关联类型 | 起点 → 终点 |
| --- | --- |
| investigates | experiment → question |
| executes | run → experiment |
| from_run | result → run |
| supports / qualifies / contradicts | result → conclusion |
| answers | conclusion → question |

结果需要 sources 和 from_run 关联；结论需要结果证据，使用 limits 说明适用边界。可使用 campaign、method、status、summary、conditions 等字段改善展示。examples/demo.json 展示完整关系；其路径引用属于演示导入格式，不能直接作为 record 的来源 ID。

sourcePaths 是相对于配置工作区根目录的文件路径。sources、figure、table 使用资产 ID：a- 加上路径使用 / 分隔后 SHA-256 的前 16 个十六进制字符。可以从 export 查看已登记 ID。更新已有人工记录时提交完整对象和 expectedRevision；导入器管理的记录不能被 record 覆盖，可新增后续记录关联旧证据。

文件写入批次保持原子性；来源文件不被修改。当前指纹更新不提供完整的来源版本归档，改变研究证据前应自行保留历史文件。

## Skill

codex/research-workbench/SKILL.md 是随包提供的基础 skill。可让智能体直接阅读并使用；本项目不会自动修改全局智能体配置。其重点是分开记录观察和解释、保留来源及适用条件、使用明确关联和版本检查。

## 验证

~~~powershell
npm test
~~~

测试在 runtime/ 下建立干净副本，使用虚构数据，不读取本地适配器或操作现有研究数据库。

Windows 可使用已安装的 Chrome 或 Edge 做真实浏览器验收，先启动工作台，再运行：

~~~powershell
powershell -NoProfile -File scripts/Test-Browser.ps1
~~~

也可传入 -BaseUrl http://127.0.0.1:4318。浏览器临时配置留在 runtime/，截图及报告留在 acceptance/。这些产物可能包含正在查看的研究内容，默认不提交。

## Git 边界

local/、data/、runtime/、acceptance/ 和临时日志不属于公开源码。根目录采用默认忽略、仅开放维护目录的规则；公开提交仍需审查文件内容。

若工具嵌套在另一个仓库中，在父仓库的本地 .git/info/exclude 添加工具目录路径，并在工具目录中操作其独立 Git 仓库。父仓库与工具仓库具有各自的提交历史和远程地址。

仓库公开不等于研究数据公开，也不会将本机网页发布到互联网。package.json 中的 private: true 仅防止意外发布 npm 包，不影响 GitHub 仓库可见性。
