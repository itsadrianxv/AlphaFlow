"""统一数据 provider 异常。"""

from __future__ import annotations


class DataProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        provider: str = "unknown",
        code: str = "data_provider_error",
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.code = code
        self.retryable = retryable


class DataProviderConfigurationError(DataProviderError):
    def __init__(self, message: str, *, provider: str = "unknown") -> None:
        super().__init__(
            message,
            provider=provider,
            code="provider_configuration_error",
            retryable=False,
        )


class DataUnavailableError(DataProviderError):
    def __init__(
        self,
        message: str,
        *,
        provider: str = "unknown",
        retryable: bool = True,
    ) -> None:
        super().__init__(
            message,
            provider=provider,
            code="data_unavailable",
            retryable=retryable,
        )


class InvalidSymbolError(DataProviderError):
    def __init__(self, message: str, *, provider: str = "unknown") -> None:
        super().__init__(
            message,
            provider=provider,
            code="invalid_symbol",
            retryable=False,
        )


class UnsupportedDatasetError(DataProviderError):
    def __init__(self, message: str, *, provider: str = "unknown") -> None:
        super().__init__(
            message,
            provider=provider,
            code="unsupported_dataset",
            retryable=False,
        )
