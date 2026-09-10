import subprocess
import sys

from bitbrowser import BitBrowserClient, BrowserService, GroupService
from scripts.check_bitbrowser import check


class HealthyClient:
    def request(self, path, payload=None):
        assert path == "/health"
        return {"status": "ok"}


def test_health_check_reports_success():
    assert check(HealthyClient()) == {"ok": True, "data": {"status": "ok"}}


def test_public_services_are_constructible():
    client = BitBrowserClient(transport=object())
    assert isinstance(BrowserService(client), BrowserService)
    assert isinstance(GroupService(client), GroupService)


def test_check_script_runs_directly_from_project_root():
    result = subprocess.run(
        [sys.executable, "scripts/check_bitbrowser.py", "--help"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
