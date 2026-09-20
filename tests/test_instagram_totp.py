import pytest
import subprocess
import sys

from instagram.totp import generate_totp


RFC_SHA1_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

# python.exe -m instagram.totp
def test_generates_six_digit_totp_and_logs_it():
    messages = []

    code = generate_totp(RFC_SHA1_SECRET, timestamp=59, log=messages.append)

    assert code == "287082"
    assert messages == ["[2FA] 当前验证码: 287082"]


def test_rejects_an_invalid_base32_secret():
    with pytest.raises(ValueError, match="2FA 密钥不是有效的 Base32 文本"):
        generate_totp("not-a-base32-secret!")


def test_module_prompts_for_a_secret_and_prints_a_code():
    result = subprocess.run(
        [sys.executable, "-m", "instagram.totp"],
        input=f"{RFC_SHA1_SECRET}\n",
        capture_output=True,
        text=True,
        timeout=5,
    )

    assert result.returncode == 0, result.stderr
    assert "请输入 Base32 2FA 密钥" in result.stdout
    assert "[2FA] 当前验证码: " in result.stdout
    assert len(result.stdout.rsplit(": ", maxsplit=1)[-1].strip()) == 6


def test_module_allows_retry_after_an_invalid_secret():
    result = subprocess.run(
        [sys.executable, "-m", "instagram.totp"],
        input=f"not-a-base32-secret!\n{RFC_SHA1_SECRET}\n",
        capture_output=True,
        text=True,
        timeout=5,
    )

    assert result.returncode == 0, result.stderr
    assert "输入错误: 2FA 密钥不是有效的 Base32 文本" in result.stdout
    assert "[2FA] 当前验证码: " in result.stdout
