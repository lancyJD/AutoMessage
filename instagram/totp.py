"""Local TOTP code generation for Instagram two-factor authentication."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import time
from collections.abc import Callable


def generate_totp(
    secret: str,
    timestamp: float | None = None,
    *,
    digits: int = 6,
    period: int = 30,
    algorithm: str = "sha1",
    log: Callable[[str], object] | None = print,
) -> str:
    """Generate and optionally log a TOTP code from a Base32 secret."""
    if not isinstance(secret, str):
        raise ValueError("2FA 密钥不是有效的 Base32 文本")
    normalized = "".join(secret.split()).upper()
    if not normalized or not re.fullmatch(r"[A-Z2-7]+=*", normalized):
        raise ValueError("2FA 密钥不是有效的 Base32 文本")
    if digits <= 0 or period <= 0:
        raise ValueError("验证码位数和周期必须为正数")

    unpadded = normalized.rstrip("=")
    padding = "=" * (-len(unpadded) % 8)
    try:
        key = base64.b32decode(unpadded + padding)
    except ValueError as exc:
        raise ValueError("2FA 密钥不是有效的 Base32 文本") from exc

    try:
        digestmod = hashlib.new(algorithm).name
    except ValueError as exc:
        raise ValueError(f"不支持的哈希算法: {algorithm}") from exc

    unix_timestamp = time.time() if timestamp is None else timestamp
    counter = int(unix_timestamp) // period
    digest = hmac.new(key, counter.to_bytes(8, "big"), digestmod).digest()
    offset = digest[-1] & 0x0F
    number = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    code = f"{number % (10**digits):0{digits}d}"

    if log is not None:
        log(f"[2FA] 当前验证码: {code}")
    return code


def main() -> None:
    """Prompt for a TOTP secret and print its current code."""
    while True:
        secret = input("请输入 Base32 2FA 密钥（留空退出）: ").strip()
        if not secret:
            print("未输入密钥，已退出。")
            return
        try:
            generate_totp(secret)
        except ValueError as exc:
            print(f"输入错误: {exc}")
            continue
        return


if __name__ == "__main__":
    main()
