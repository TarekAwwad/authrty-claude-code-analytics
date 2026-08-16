from ccfr.main import create_app


def test_retired_contribution_routes_are_not_registered() -> None:
    paths = {route.path for route in create_app().routes}

    assert "/api/contribution/preview" not in paths
    assert "/api/contribution/export" not in paths
