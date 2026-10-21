from app.project_store import connect


def test_project_store_configures_wal_and_busy_timeout():
    with connect() as connection:
        journal_mode = connection.execute("PRAGMA journal_mode").fetchone()[0]
        busy_timeout = connection.execute("PRAGMA busy_timeout").fetchone()[0]

    assert str(journal_mode).lower() == "wal"
    assert busy_timeout >= 5000
