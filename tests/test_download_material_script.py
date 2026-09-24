import pytest

from instagram.material_downloader import BatchSummary, DownloadResult
from scripts.download_material import build_parser, console_text, run


class FakeDownloader:
    def __init__(self):
        self.calls = []

    def download_url(self, value):
        self.calls.append(("url", value))
        return [DownloadResult("success", value)]

    def download_batch(self, values):
        self.calls.append(("batch", values))
        return BatchSummary([
            DownloadResult("success", values[0]),
            DownloadResult("failed", values[-1], message="boom"),
        ])

    def search_youtube(self, query, count=3):
        self.calls.append(("search", query, count))
        return BatchSummary([DownloadResult("success", query)])


def test_url_command_dispatches_and_reports_success(capsys):
    fake = FakeDownloader()
    args = build_parser().parse_args(["url", "https://example.test/1"])
    assert run(args, fake) == 0
    assert fake.calls == [("url", "https://example.test/1")]
    assert "成功=1" in capsys.readouterr().out


def test_batch_partial_failure_returns_one(tmp_path):
    links = tmp_path / "links.txt"
    links.write_text("https://a.test/1\nhttps://b.test/2\n", encoding="utf-8")
    fake = FakeDownloader()
    assert run(build_parser().parse_args(["batch", str(links)]), fake) == 1


def test_search_defaults_to_three_and_accepts_custom_count():
    fake = FakeDownloader()
    assert run(build_parser().parse_args(["search", "旅行"]), fake) == 0
    assert fake.calls[-1] == ("search", "旅行", 3)
    assert run(build_parser().parse_args(["search", "旅行", "--count", "5"]), fake) == 0
    assert fake.calls[-1] == ("search", "旅行", 5)


def test_parser_rejects_zero_count():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["search", "旅行", "--count", "0"])


def test_run_returns_dependency_code_when_yt_dlp_is_missing(capsys):
    class MissingDependency:
        def download_url(self, _value):
            raise ImportError("No module named yt_dlp")

    code = run(build_parser().parse_args(["url", "https://example.test/1"]), MissingDependency())
    assert code == 2
    assert "yt-dlp" in capsys.readouterr().out


def test_console_text_escapes_characters_not_supported_by_gbk():
    assert console_text("保存:맛있는영상.mp4", "gbk") == r"保存:\ub9db\uc788\ub294\uc601\uc0c1.mp4"
