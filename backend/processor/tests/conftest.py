import socket

import pytest


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Tests marked `real` run only when asked for with -m real."""
    if "real" in (config.getoption("-m") or ""):
        return
    skip = pytest.mark.skip(reason="real-tool test; run with -m real")
    for item in items:
        if "real" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def _block_network(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests use fakes and synthetic fixtures only; any outbound connection is a bug.

    Tests marked `real` may reach the network (the model weights).
    """
    if request.node.get_closest_marker("real"):
        return

    def blocked(*args: object, **kwargs: object) -> None:
        raise RuntimeError("network access is blocked in tests")

    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)
