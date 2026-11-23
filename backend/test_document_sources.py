import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import collector as c


class DocumentSourcesTest(unittest.TestCase):
    def setUp(self):
        self.source = {
            "id": "docs", "type": "official", "label": "Example pricing",
            "url": "https://example.com/pricing.md", "offer_url": "https://example.com/pricing",
            "format": "markdown", "enabled": True, "categories": ["devtools"],
            "policy_reviewed": "2026-10-24", "policy_url": "https://example.com/robots.txt",
            "attribution": "Example contributors; derived metadata, not verified terms.",
            "license_url": "https://example.com/LICENSE",
        }
        self.body = "# Plans\nFree tier: 100 requests per day. Pro: 30-day free trial then $20/month."

    def extract(self, body=None, source=None):
        with patch("collector.validate_public_url"):
            return c.extract_candidates(source or self.source, body or self.body)

    def test_multi_plan_docs_are_pointers_not_confirmed_or_mixed_plan_terms(self):
        [item] = self.extract()
        self.assertEqual(item.url, self.source["offer_url"])
        self.assertEqual(item.source_url, self.source["url"])
        self.assertEqual(item.confidence, "candidate")
        self.assertEqual(item.link_status, "not_checked")
        self.assertIsNone(item.trial_days)
        self.assertIsNone(item.price_hint)
        self.assertIsNone(item.eligibility_hint)
        self.assertEqual(item.attribution, self.source["attribution"])
        self.assertEqual(item.license_url, self.source["license_url"])
        self.assertEqual(len(item.document_hash), 64)
        self.assertTrue(c.content_type_ok("text/markdown; charset=utf-8"))
        self.assertFalse(c.content_type_ok("application/octet-stream"))

    def test_quota_change_updates_state_and_304_retains_hash_and_attribution(self):
        state = {"candidates": {}}
        self.assertEqual(c.apply_state(self.extract(), state, {"docs"}, "t1")[0].status, "new")
        self.assertEqual(c.apply_state(self.extract(), state, {"docs"}, "t2")[0].status, "unchanged")
        self.assertEqual(c.apply_state(self.extract(self.body.replace("100", "200")), state, {"docs"}, "t3")[0].status, "updated")
        [cached] = c.cached_candidates(state, "docs")
        self.assertTrue(cached.document_hash)
        self.assertEqual(cached.attribution, self.source["attribution"])
        self.assertEqual(c.apply_state([cached], state, {"docs"}, "t4")[0].status, "unchanged")

    def test_missing_signals_or_policy_cannot_succeed_and_mark_a_candidate_gone(self):
        with self.assertRaisesRegex(ValueError, "no offer signals"):
            self.extract("This document has moved; please check back later.")
        for key in ["policy_reviewed", "policy_url", "attribution", "license_url"]:
            source = {**self.source, key: ""}
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.extract(source=source)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "sources.json"
            config.write_text(json.dumps([self.source]))
            state = {"candidates": {}}
            c.apply_state(self.extract(), state, {"docs"}, "t1")
            c.save_state(root, state)
            empty = c.FetchResult(url=self.source["url"], ok=True, text="No content available")
            with patch("collector.fetch_with_304", return_value=empty), patch("collector.load_user_submissions", return_value=[]), patch("collector.validate_public_url"):
                items, errors = c.run_collection(config, root, quiet=True)
            self.assertEqual(len(errors), 1)
            self.assertEqual(items[0].status, "unchanged")
            self.assertEqual(items[0].last_seen, "t1")

    def test_offer_url_cannot_point_to_private_or_unrelated_hosts(self):
        with self.assertRaises(Exception):
            c.extract_candidates({**self.source, "offer_url": "http://127.0.0.1/private"}, self.body)
        with self.assertRaisesRegex(ValueError, "source host"):
            self.extract(source={**self.source, "offer_url": "https://other.example/pricing"})

    def test_checked_in_sources_have_two_permitted_document_endpoints_and_no_product_hunt(self):
        sources = json.loads((c.ROOT / "sources.json").read_text())
        enabled = [source for source in sources if source.get("enabled")]
        self.assertEqual({source["id"] for source in enabled}, {"cloudflare-workers-official", "github-copilot-official"})
        for source in enabled:
            self.assertEqual(source["format"], "markdown")
            self.assertFalse(source["verify_links"])
            self.assertEqual(source["max_candidates"], 1)
            self.assertTrue(source["policy_url"])
            self.assertTrue(source["license_url"])
        self.assertFalse(next(source for source in sources if source["id"] == "product-hunt")["enabled"])


if __name__ == "__main__":
    unittest.main()
