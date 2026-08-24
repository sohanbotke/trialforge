from __future__ import annotations

import unittest
from unittest.mock import patch
from urllib.error import URLError

from collector import (
    cap_submission_score,
    classify_landing_page,
    extract_candidates,
    parse_bool,
    source_confidence,
    validate_public_url,
)


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

    def test_classify_landing_page_detects_trial_signal(self) -> None:
        page = "<html><body>Start your free trial today. Intro pricing ends soon.</body></html>"
        self.assertEqual(classify_landing_page(page), "trial-page")

    def test_extract_candidates_uses_direct_link_when_present(self) -> None:
        source = {
            "id": "demo-source",
            "type": "official",
            "label": "Demo",
            "url": "https://example.com/pricing",
            "categories": ["shows"],
            "verify_links": False,
        }
        html = """
        <html><body>
          <a href="/trial">Start free trial</a>
          <p>Generic page copy with no offer.</p>
        </body></html>
        """
        with patch("collector.validate_public_url"):
            candidates = extract_candidates(source, html)
        self.assertEqual(candidates[0].url, "https://example.com/trial")
        self.assertEqual(candidates[0].link_status, "not_checked")
        self.assertEqual(candidates[0].landing_match, "not_checked")

    def test_extract_candidates_rejects_private_link_even_when_not_checked(self) -> None:
        source = {
            "id": "demo-source",
            "type": "rss",
            "label": "Demo",
            "url": "https://example.com/feed",
            "categories": ["shows"],
            "verify_links": False,
        }
        html = '<a href="http://127.0.0.1:8000/admin">Start free trial</a>'
        self.assertEqual(extract_candidates(source, html), [])

    def test_source_confidence_does_not_overtrust_off_domain_official_links(self) -> None:
        source = {
            "type": "official",
            "url": "https://example.com/pricing",
        }
        self.assertEqual(source_confidence(source, "https://promo.example.net/trial"), "candidate")

    def test_string_false_is_not_verified(self) -> None:
        self.assertFalse(parse_bool("false"))
        self.assertFalse(parse_bool(""))
        self.assertTrue(parse_bool("true"))

    def test_unverified_submission_score_is_capped(self) -> None:
        self.assertEqual(cap_submission_score(999, verified=False), 55)
        self.assertEqual(cap_submission_score(999, verified=True), 90)


if __name__ == "__main__":
    unittest.main()
