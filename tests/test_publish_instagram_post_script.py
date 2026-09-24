import asyncio
import subprocess
import sys
from argparse import Namespace

from scripts.publish_instagram_post import _report, build_parser, run


def test_help_lists_repeatable_media_and_caption_options():
    result = subprocess.run(
        [sys.executable, "scripts/publish_instagram_post.py", "--help"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "--media" in result.stdout
    assert "--title" in result.stdout
    assert "--content" in result.stdout


def test_parser_preserves_repeated_media_order():
    args = build_parser().parse_args(["--media", "first.png", "--media", "second.mp4"])
    assert args.media == ["first.png", "second.mp4"]


def test_parser_requires_at_least_one_media():
    try:
        build_parser().parse_args([])
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("parser accepted an empty media list")


class ExplodingPreparer:
    def prepare(self, media):
        raise RuntimeError("leaked demo_pass and JBSWY3DPEHPK3PXP")


def test_runtime_errors_redact_account_secrets(tmp_path, capsys):
    account = tmp_path / "account.md"
    account.write_text(
        "| username | password | cookie | two_factor_secret |\n|---|---|---|---|\n"
        "| demo | demo_pass |  | JBSWY3DPEHPK3PXP |\n",
        encoding="utf-8",
    )
    args = Namespace(media=["photo.png"], title="", content="", account_file=account, relogin=False)
    assert asyncio.run(run(args, media_preparer=ExplodingPreparer())) == 1
    output = capsys.readouterr().out
    assert "demo_pass" not in output
    assert "JBSWY3DPEHPK3PXP" not in output


def test_run_reports_one_structured_payload_on_runtime_failure(tmp_path):
    account = tmp_path / "account.md"
    account.write_text(
        "| username | password | cookie | two_factor_secret |\n|---|---|---|---|\n"
        "| demo | demo_pass |  | JBSWY3DPEHPK3PXP |\n",
        encoding="utf-8",
    )
    args = Namespace(media=["photo.png"], title="", content="", account_file=account, relogin=False)
    payloads = []
    code = asyncio.run(run(args, media_preparer=ExplodingPreparer(), reporter=payloads.append))
    assert code == 1
    assert len(payloads) == 1
    assert payloads[0]["stage"] == "runtime"
    assert "demo_pass" not in payloads[0]["message"]


def test_report_preserves_unknown_code_with_gbk_stdout(monkeypatch):
    class GbkStdout:
        encoding = "gbk"

        def write(self, value):
            value.encode("gbk")

        def flush(self):
            return None

    payloads = []
    monkeypatch.setattr(sys, "stdout", GbkStdout())
    code = _report(4, "unknown", "share", "demo", 1, None, "결과를 확인할 수 없습니다", [], payloads.append)
    assert code == 4
    assert [payload["status"] for payload in payloads] == ["unknown"]
