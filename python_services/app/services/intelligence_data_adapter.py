"""
Intelligence data adapter
Provides lightweight theme news and company evidence data for workflow agents.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
import random


class IntelligenceDataAdapter:
    """Adapter for intelligence endpoints used by LangGraph workflow."""

    @staticmethod
    def get_theme_news(theme: str, days: int = 7, limit: int = 20) -> list[dict]:
        base_titles = [
            "政策信号增强，产业资本关注度提升",
            "龙头公司披露阶段性订单进展",
            "上游成本波动，利润分配再平衡",
            "机构调研活跃，赛道景气度分化",
            "海外需求边际改善，出口链条受益",
            "关键技术迭代，设备投资窗口开启",
            "竞争格局重塑，中小企业出清加速",
            "估值回归中枢，资金偏好趋于理性",
            "主题热度升温，短期交易拥挤",
            "产业协同加快，跨界合作增加",
        ]

        now = datetime.now()
        items: list[dict] = []

        for index in range(min(limit, len(base_titles))):
            seed = f"{theme}-{index}-{days}"
            digest = hashlib.md5(seed.encode("utf-8")).hexdigest()
            score = int(digest[:2], 16) / 255
            sentiment = (
                "positive"
                if score > 0.66
                else "negative"
                if score < 0.33
                else "neutral"
            )
            published_at = now - timedelta(hours=index * max(1, days))

            items.append(
                {
                    "id": f"{theme}-{index}",
                    "title": f"{theme}: {base_titles[index]}",
                    "summary": f"围绕{theme}的资讯显示，市场关注点集中在盈利兑现与需求验证。",
                    "source": "akshare-mock-feed",
                    "publishedAt": published_at.isoformat(),
                    "sentiment": sentiment,
                    "relevanceScore": round(max(0.2, min(0.95, score)), 2),
                    "relatedStocks": _guess_related_stocks(theme),
                }
            )

        return items

    @staticmethod
    def get_company_evidence(stock_code: str, concept: str | None = None) -> dict:
        seed_text = f"{stock_code}-{concept or 'general'}"
        digest = hashlib.sha256(seed_text.encode("utf-8")).hexdigest()
        random.seed(int(digest[:8], 16))

        credibility_score = random.randint(58, 92)
        concept_name = concept or "通用赛道"

        return {
            "stockCode": stock_code,
            "companyName": _guess_company_name(stock_code),
            "concept": concept_name,
            "evidenceSummary": f"{stock_code} 在 {concept_name} 方向具备一定产业协同与订单验证信号。",
            "catalysts": [
                "近期公告显示产品/订单节奏改善",
                "行业需求侧存在边际回暖迹象",
                "估值处于历史中枢附近",
            ],
            "risks": [
                "主题交易拥挤导致波动放大",
                "业绩兑现节奏低于市场预期",
                "上游成本波动影响毛利率",
            ],
            "credibilityScore": credibility_score,
            "updatedAt": datetime.now().isoformat(),
        }

    @staticmethod
    def get_company_evidence_batch(stock_codes: list[str], concept: str) -> list[dict]:
        return [
            IntelligenceDataAdapter.get_company_evidence(code, concept)
            for code in stock_codes
        ]


def _guess_related_stocks(theme: str) -> list[str]:
    lowered = theme.lower()

    if "ai" in lowered or "人工智能" in theme:
        return ["002230", "603019", "300308"]

    if "半导体" in theme or "芯片" in theme:
        return ["688981", "603986", "688012"]

    if "新能源" in theme or "储能" in theme:
        return ["300750", "002594", "601012"]

    return ["600036", "600519", "601318"]


def _guess_company_name(stock_code: str) -> str:
    mapping = {
        "002230": "科大讯飞",
        "603019": "中科曙光",
        "300308": "中际旭创",
        "688981": "中芯国际",
        "603986": "兆易创新",
        "688012": "中微公司",
        "300750": "宁德时代",
        "002594": "比亚迪",
        "601012": "隆基绿能",
        "600036": "招商银行",
        "600519": "贵州茅台",
        "601318": "中国平安",
    }

    return mapping.get(stock_code, f"公司{stock_code}")
