from __future__ import annotations

import unittest
from urllib.error import URLError

from collector import validate_public_url


class CollectorSafetyTest(unittest.TestCase):
    def test_validate_public_url_rejects_local_or_private_targets(self) -> None:
        blocked = [
            "file:///etc/passwd",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://10.0.0.1",
            "http://100.64.0.1",
            "http://169.254.169.254",
        ]
        for url in blocked:
            with self.subTest(url=url), self.assertRaises(URLError):
                validate_public_url(url)


if __name__ == "__main__":
    unittest.main()
