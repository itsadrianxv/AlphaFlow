CCTV 新闻
获取 CCTV 新闻。数据自 2020 起覆盖，按日期查询。

调用示例
复制
import minishare as ms

# 调用示例 - CCTV 新闻
token = "授权码"
df = ms.pro_api(token).cctv_news(
    date='20251229'
)
print(df)
参数说明
参数	类型	说明
date	string	日期，格式：YYYYMMDD，如 20181211