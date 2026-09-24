from instagram.totp import generate_totp


def test_totp_can_be_generated_without_logging(capsys):
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert generate_totp(secret, timestamp=59, log=None) == "287082"
    assert capsys.readouterr().out == ""
