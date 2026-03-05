# Stock Screening Data Service

Python FastAPI 微服务，为股票筛选平台提供金融数据接口（基于 AkShare）。

## 技术栈

- **FastAPI**: 现代、高性能的 Web 框架
- **Uvicorn**: ASGI 服务器
- **AkShare**: 金融数据获取库
- **Pydantic**: 数据验证

## 项目结构

```
python_services/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 入口
│   ├── routers/             # API 路由
│   │   ├── __init__.py
│   │   └── stock_data.py    # 股票数据路由（待实现）
│   └── services/            # 业务逻辑
│       ├── __init__.py
│       └── akshare_adapter.py  # AkShare 数据适配器（待实现）
├── tests/                   # 测试文件（待创建）
├── requirements.txt         # 依赖列表
└── README.md
```

## 安装

1. 创建虚拟环境（推荐）：
```bash
cd python_services
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或
venv\Scripts\activate  # Windows
```

2. 安装依赖：
```bash
pip install -r requirements.txt
```

## 运行

开发模式（热重载）：
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

生产模式：
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

## API 文档

启动服务后访问：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## 测试

```bash
pytest
```

## 与 T3 Stack 集成

本服务通过 HTTP API 与 T3 Stack 主应用通信：
- T3 侧通过 `src/server/infrastructure/screening/python-data-service-client.ts` 调用本服务
- CORS 已配置允许 `localhost:3000` 和 `localhost:3001`
- 领域层通过接口反转（IMarketDataRepository、IHistoricalDataProvider）解耦
