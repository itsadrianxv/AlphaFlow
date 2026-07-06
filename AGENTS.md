# AGENTS

## 自动 Git 提交规则

及时执行 `git add {修改的文件}`、`git commit -m "<message>"`、`git push`：

## Commit 消息格式

使用中文，遵循 Conventional Commits 风格：

```
<type>: <简要描述>

<可选的详细说明>
```

## 注意事项

- 不要积攒多个不相关的变更到一个 commit
- commit 消息要准确描述本次变更内容
- 如果一次用户请求涉及多个不相关的改动，拆分为多个 commit


## 中文编码
- 所有文件读写、脚本生成、批量替换和自动编辑都必须显式使用 **UTF-8**
- 禁止使用系统默认编码、GBK/GB2312/CP936 或会导致中文 mojibake 的工具链保存文件